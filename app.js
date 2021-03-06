(function() {

  return {

    PER_PAGE: 10,

    MAX_ATTEMPTS: 20,

    defaultState: 'loading',

    agentOptions: [],

    events: {
      'app.activated': 'init',
      '*.changed': 'handleChanged',
      'searchDesk.done': 'handleResults',
      'searchDesk.fail': 'handleFail',
      'getUsers.done': 'handleUsers',
      'click .options a': 'toggleAdvanced',
      'click .suggestion': 'suggestionClicked',
      'click .search-icon': 'doTheSearch',
      'click .page': 'handleChangePage',
      'keydown .search-box': 'handleKeydown',
      'requiredProperties.ready': 'loadSearchSuggestions'
    },

    requests: {

      getUsers: function(pageUrl) {
        return {
          url: pageUrl || '/api/v2/group_memberships/assignable.json?include=users&page=1',
          type: 'GET'
        };
      },

      searchDesk: function(params) {
        return {
          url: params.pageUrl || helpers.fmt('/api/v2/search.json?per_page=%@&query=%@', this.PER_PAGE, params.query),
          type: 'GET'
        };
      }

    },

    init: function(data) {
      if(!data.firstLoad){
        return;
      }

      this.hasActivated = true;
      this.currAttempt = 0;
      this.requiredProperties = [];

      if (this.settings.custom_fields) {
        this.customFieldIDs = this.settings.custom_fields.match(/\d+/g);
      } else {
        this.customFieldIDs = [];
      }

      if (this.currentLocation() == 'ticket_sidebar') {
        this.requiredProperties.push('ticket.id', 'ticket.subject');
      }

      _.defer((function() {
        this.trigger('requiredProperties.ready');
        this.switchTo('search');
      }).bind(this));
    },

    suggestionClicked: function(e){
      var $searchBox = this.$('.search-box');
      $searchBox.val( $searchBox.val() + ' ' + this.$(e.target).text() );

      this.doTheSearch();

      return false;
    },

    toggleAdvanced: function(e){
      var $advancedOptions = this.$('.advanced-options-wrapper');
      if($advancedOptions.is(':hidden')){
        this.$('.options .basic').show();
        this.$('.options .advanced').hide();

        // Load users when advanced is clicked
        this.populateAssignees();

        $advancedOptions.slideDown();
        $advancedOptions.addClass('visible');
      } else {
        $advancedOptions.slideUp();
        this.$('.options .advanced').show();
        this.$('.options .basic').hide();
        $advancedOptions.removeClass('visible');
      }
    },

    populateAssignees: function() {
      if (!this.agentOptions.length) {
        this.ajax('getUsers');
      } else if (this.$('#assignee option').length === 1) {
        // used cached agentOptions
        this._populateSelectBox('#assignee', this.agentOptions);
      }
    },

    handleUsers: function(data) {
      // populate the assignee drop down, excluding duplicates
      _.each(data.users, function(agent) {
        if (!_.contains(this.agentOptions, agent.name)) {
          this.agentOptions.push(agent.name);
        }
      }, this);

      if (data.next_page) {
        this.ajax('getUsers', data.next_page);
      } else {
        // we have all assignable users, sort and add to select box
        this.agentOptions.sort(function (a, b) {
          return a.toLowerCase().localeCompare(b.toLowerCase());
        });

        this._populateSelectBox('#assignee', this.agentOptions);
      }
    },

    searchParams: function(){
      var $search = this.$('.search');
      var params = [];
      var searchType = $search.find('#type').val();
      var searchTerm = $search.find('.search-box').val();

      if (searchType !== "all") {
        params.push( helpers.fmt('type:%@', searchType) );
      }

      if (this.$('.advanced-options').is(':visible')) {

        // Status
        var filter = $search.find('#filter').val();
        var condition = $search.find('#condition').val();
        var value = $search.find('#value').val();

        if (filter && condition && value) {
          params.push([filter, condition, value].join(''));
        }

        // Created
        var range = $search.find('#range').val();
        var from = $search.find('#from').val();
        var to = $search.find('#to').val();

        if (range && (from || to)) {
          if (from) {
            params.push( helpers.fmt('%@>%@', range, from) );
          }
          if (to) {
            params.push( helpers.fmt('%@<%@', range, to) );
          }
        }

        // Assignee
        var assignee = $search.find('#assignee').val();

        if (assignee) {
          params.push( helpers.fmt('assignee:"%@"', assignee) );
        }

      }

      return helpers.fmt('%@ %@', searchTerm, params.join(" "));
    },

    doTheSearch: function(){
      this.$('.results').empty();
      this.$('.searching').show();

      // encodeURIComponent is used here to force IE to encode all characters
      this.ajax('searchDesk', { query: encodeURIComponent(this.searchParams()) });
    },

    handleKeydown: function(e){
      if (e.which === 13) {
        this.doTheSearch();
        return false;
      }
    },

    handleChangePage: function(e){
      this.$('.results').empty();
      this.$('.searching').show();

      this.ajax('searchDesk', { pageUrl: this.$(e.target).data('url') });
    },

    handleResults: function (data) {
      var ticketId = this.ticket().id();

      _.each(data.results, function(result, index) {
        result["is_" + result.result_type] = true;

        // format descriptions
        if (result.is_ticket) {
          // remove current ticket from results
          if (result.id === ticketId) data.results.splice(index,1);
          result.description = result.description.substr(0,300).concat("...");
        }
        else if (this.is_topic) {
          result.body = result.body.substr(0,300).concat("...");
        }

      });

      data.count = this.I18n.t('search.results', { count: data.count });
      var resultsTemplate = this.renderTemplate('results', data);

      this.$('.searching').hide();
      this.$('.results').html(resultsTemplate);
    },

    handleChanged: _.debounce(function(property) {
      // test if change event fired before app.activated
      if (!this.hasActivated) {
        return;
      }

      var ticketField = property.propertyName,
          ticketFieldsChanged = false;

      if (ticketField.match(/custom_field/) && this.customFieldIDs.length) {
        ticketFieldsChanged = !!_.find(this.customFieldIDs, function(id) {
          return ticketField === helpers.fmt("ticket.custom_field_%@", id);
        });
      } else if (ticketField === 'ticket.subject') {
        ticketFieldsChanged = true;
      }

      if (ticketFieldsChanged) {
        this.loadSearchSuggestions();
      }
    }, 500),

    loadSearchSuggestions: function() {
      var searchSuggestions = this.loadCustomFieldSuggestions(),
          ticketSubject = this.ticket().subject(),
          suggestionsTemplate = "",
          keywords = "";

      if (this.settings.related_tickets && ticketSubject) {
        keywords = this.extractKeywords(ticketSubject);
        searchSuggestions.push.apply( searchSuggestions, keywords );
      }

      suggestionsTemplate = this.renderTemplate('suggestions', { searchSuggestions: searchSuggestions });
      this.$('.suggestions').html(suggestionsTemplate);
    },

    loadCustomFieldSuggestions: function(){
      var customFieldSuggestions = [];

      if (!this.customFieldIDs) {
        return customFieldSuggestions;
      }

      _.each(this.customFieldIDs, function(customFieldID){
        var customFieldName = 'custom_field_' + customFieldID,
            customFieldValue = this.ticket().customField(customFieldName);

        if (customFieldValue) {
          customFieldSuggestions.push( customFieldValue );
        }
      }, this);

      return customFieldSuggestions;
    },

    extractKeywords: function(text) {
      // strip punctuation and extra spaces
      text = text.toLowerCase().replace(/[\.,-\/#!$?%\^&\*;:{}=\-_`~()]/g,"").replace(/\s{2,}/g," ");

      // split by spaces
      var words = text.split(" "),
          exclusions = this.I18n.t('stopwords.exclusions').split(","),
          keywords = _.difference(words, exclusions);

      return keywords;
    },

    handleFail: function (data) {
      var response = JSON.parse(data.responseText);
      var message = "";

      if (response.error) {
        message = this.I18n.t("global.error.%@".fmt(response.error));
      } else if (response.description) {
        message = response.description;
      } else {
        message = this.I18n.t('global.error.message');
      }

      var error = {
        title: this.I18n.t('global.error.title'),
        message: message
      };

      var errorTemplate = this.renderTemplate('error', error);

      this.$('.searching').hide();
      this.$('.results').html(errorTemplate);
    },

    showError: function(title, msg) {
      this.switchTo('error', {
        title: title || this.I18n.t('global.error.title'),
        message: msg || this.I18n.t('global.error.message')
      });
    },

    _populateSelectBox: function(selector, values) {
      var htmlOptions = _.reduce(values, function(options, value) {
        return options + helpers.fmt('<option value="%@1">%@1</option>', value);
      }, '<option value="">-</option>');

      this.$(selector).html(htmlOptions);
    },

    _safeGetPath: function(propertyPath) {
      return _.inject( propertyPath.split('.'), function(context, segment) {
        if (context == null) { return context; }
        var obj = context[segment];
        if (_.isFunction(obj)) { obj = obj.call(context); }
        return obj;
      }, this);
    },

    _validateRequiredProperty: function(propertyPath) {
      var value = this._safeGetPath(propertyPath);
      return value != null && value !== '' && value !== 'no';
    }

  };

}());

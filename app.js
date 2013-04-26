(function() {

  return {

    per_page: 10,

    currAttempt: 0,
    MAX_ATTEMPTS: 20,

    defaultState: 'loading',

    agentOptions: [],

    events: {
      'app.activated': 'init',
      'searchDesk.done': 'handleResults',
      'searchDesk.fail': 'handleFail',
      'getUsers.done': 'handleUsers',
      'click .options a': 'toggleAdvanced',
      'click .suggestion': 'suggestionClicked',
      'click .search-icon': 'doTheSearch',
      'click .page': 'handleChangePage',
      'keydown .search-box': 'handleKeydown',
      'requiredProperties.ready': 'handleRequiredProperties'
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
          url: params.pageUrl || helpers.fmt('/api/v2/search.json?per_page=%@&query=%@', this.per_page, params.query),
          type: 'GET'
        };
      }

    },

    init: function(data) {
      if(!data.firstLoad){
        return;
      }

      this.requiredProperties = [
        'ticket.id',
        'ticket.subject'
      ];

      this._allRequiredPropertiesExist();
    },

    loadSearchSuggestions: function(){
      if (_.isUndefined(this.settings.custom_fields)){
        return [];
      }
      var customFieldIDs = this.settings.custom_fields.match(/\d+/g);
      var searchSuggestions = [];

      _.each(customFieldIDs, function(customFieldID){

        var customFieldName = 'custom_field_' + customFieldID;
        var customFieldValue = this.ticket().customField(customFieldName);

        if ( customFieldValue ) {
          searchSuggestions.push( customFieldValue );
        }

      }, this);

      return searchSuggestions;

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
        if (!this.agentOptions.length) {
          this.ajax('getUsers');
        } else if (this.$('select#assignee option').length === 1) {
          // used cached agentOptions
          this.$('select#assignee').html('<option value="">-</option>' + this.agentOptions.join(""));
        }

        $advancedOptions.slideDown();
        $advancedOptions.addClass('visible');
      } else {
        $advancedOptions.slideUp();
        this.$('.options .advanced').show();
        this.$('.options .basic').hide();
        $advancedOptions.removeClass('visible');
      }
    },

    handleUsers: function(data) {
      // populate the assignee drop down, excluding duplicates
      _.each(data.users, function(agent) {
        var agentOption = helpers.fmt('<option value="%@1">%@1</option>', agent.name);
        if (!_.contains(this.agentOptions, agentOption)) {
          this.agentOptions.push(agentOption);
        }
      }, this);

      if (data.next_page) {
        this.ajax('getUsers', data.next_page);
      } else {
        // we have all assignable users, sort and add to select box
        var assigneeOptionsHtml = this.agentOptions.sort(function (a, b) {
          return a.toLowerCase().localeCompare(b.toLowerCase());
        }).join("");
        this.$('select#assignee').html('<option value="">-</option>' + assigneeOptionsHtml);
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

      if ( this.$('.advanced-options').is(':visible') ) {

        // Status
        var filter = $search.find('#filter').val();
        var condition = $search.find('#condition').val();
        var value = $search.find('#value').val();

        if ( filter && condition && value ) {
          params.push( helpers.fmt('%@%@%@', filter, condition, value) );
        }

        // Created
        var range = $search.find('#range').val();
        var from = $search.find('#from').val();
        var to = $search.find('#to').val();

        if ( range && (from || to) ) {
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

    extractKeywords: function(text) {
      // strip punctuation and extra spaces
      text = text.toLowerCase().replace(/[\.,-\/#!$?%\^&\*;:{}=\-_`~()]/g,"").replace(/\s{2,}/g," ");

      // split by spaces
      var words = text.split(" ");

      var exclusions = this.I18n.t('stopwords.exclusions').split(",");

      var keywords = _.difference(words, exclusions);

      return keywords;
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

    handleRequiredProperties: function() {
      var keywords;
      var searchSuggestions = this.loadSearchSuggestions();

      if ( this.settings.related_tickets ) {
        keywords = this.extractKeywords(this.ticket().subject()).join(" ");
        searchSuggestions = searchSuggestions.concat(keywords);
      }

      this.switchTo('search', { searchSuggestions: searchSuggestions });
    },

    handleFail: function (data) {
      var response = JSON.parse(data.responseText);

      var error = {
        title: this.I18n.t('global.error.title'),
        message: response.description || this.I18n.t('global.error.message')
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

    _allRequiredPropertiesExist: function() {
      if (this.requiredProperties.length > 0) {
        var valid = this._validateRequiredProperty(this.requiredProperties[0]);

        // prop is valid, remove from array
        if (valid) {
          this.requiredProperties.shift();
        }

        if (this.requiredProperties.length > 0 && this.currAttempt < this.MAX_ATTEMPTS) {
          if (!valid) {
            ++this.currAttempt;
          }

          _.delay(_.bind(this._allRequiredPropertiesExist, this), 100);
          return;
        }
      }

      if (this.currAttempt < this.MAX_ATTEMPTS) {
        this.trigger('requiredProperties.ready');
      } else {
        this.showError(null, this.I18n.t('global.error.data'));
      }
    },

    _safeGetPath: function(propertyPath) {
      return _.inject( propertyPath.split('.'), function(context, segment) {
        if (context == null) { return context; }
        var obj = context[segment];
        if ( _.isFunction(obj) ) { obj = obj.call(context); }
        return obj;
      }, this);
    },

    _validateRequiredProperty: function(propertyPath) {
      var value = this._safeGetPath(propertyPath);
      return value != null && value !== '' && value !== 'no';
    }

  };

}());
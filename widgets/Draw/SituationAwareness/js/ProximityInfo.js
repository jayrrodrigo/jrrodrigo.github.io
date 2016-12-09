define([
  'dojo/_base/declare',
  'dojo/_base/lang',
  'dojo/_base/Color',
  'dojo/_base/array',
  'dojo/DeferredList',
  'dojo/dom-class',
  'dojo/dom-construct',
  'dojo/dom-style',
  'dojo/on',
  'esri/geometry/geometryEngine',
  'esri/graphic',
  'esri/layers/FeatureLayer',
  'esri/symbols/SimpleMarkerSymbol',
  'esri/symbols/SimpleLineSymbol',
  'esri/symbols/Font',
  'esri/symbols/TextSymbol',
  'esri/tasks/query',
  'jimu/CSVUtils',
  'jimu/utils'
], function (
  declare,
  lang,
  Color,
  array,
  DeferredList,
  domClass,
  domConstruct,
  domStyle,
  on,
  geometryEngine,
  Graphic,
  FeatureLayer,
  SimpleMarkerSymbol,
  SimpleLineSymbol,
  Font,
  TextSymbol,
  Query,
  CSVUtils,
  utils
) {

  var proximityInfo = declare('ProximityInfo', null, {

    constructor: function (tab, container, parent) {
      this.tab = tab;
      this.container = container;
      this.parent = parent;
      this.incident = null;
      this.graphicsLayer = null;
      this.specialFields = {};
      this.dateFields = {};
      this.config = parent.config;
      //this._graphics = [];
    },

    // update for incident
    updateForIncident: function (incident, distance, graphicsLayer) {
      array.forEach(this.tab.tabLayers, lang.hitch(this, function (tab) {
        if (typeof (tab.empty) !== 'undefined') {
          var tempFL = new FeatureLayer(tab.url);
          on(tempFL, "load", lang.hitch(this, function () {
            this.tab.tabLayers = [tempFL];
            this.processIncident(incident, distance, graphicsLayer);
          }));
        } else {
          this.processIncident(incident, distance, graphicsLayer);
        }
      }));
    },

    // process incident
    processIncident: function (incident, buffer, graphicsLayer) {
      this.container.innerHTML = "";
      this.buffer = buffer;
      domClass.add(this.container, "loading");
      var results = [];
      this.incident = incident;
      this.graphicsLayer = graphicsLayer;
      var tabLayers = this.tab.tabLayers;
      var defArray = [];
      for (var i = 0; i < tabLayers.length; i++) {
        var layer = tabLayers[i];
        var query = new Query();
        query.returnGeometry = true;
        query.geometry = buffer.geometry;
        if (this.parent.config.csvAllFields === "true" || this.parent.config.csvAllFields === true) {
          query.outFields = ['*'];
        } else {
          query.outFields = this._getFields(layer);
        }
        if(typeof(layer.queryFeatures) !== 'undefined'){
          defArray.push(layer.queryFeatures(query));
        }
      }
      var defList = new DeferredList(defArray);
      defList.then(lang.hitch(this, function (defResults) {
        for (var r = 0; r < defResults.length; r++) {
          var featureSet = defResults[r][1];
          var layer = tabLayers[r];
          var fields = this._getFields(layer);
          if (featureSet && featureSet.features) {
            var graphics = featureSet.features;
            for (var g = 0; g < graphics.length; g++) {
              var gra = graphics[g];
              var geom = gra.geometry;
              // var loc = geom;
              // if (geom.type !== "point") {
              //   loc = geom.getExtent().getCenter();
              // }
              var dist = this._getDistance(incident.geometry, geom);
              var newAttr = {
                DISTANCE: dist
              };
              for (var f = 0; f < fields.length; f++) {
                newAttr[fields[f]] = gra.attributes[fields[f]];
              }
              if (this.config.csvAllFields === true || this.config.csvAllFields === "true") {
                //do nothing.  All fields in graphic will export.
                gra.attributes.DISTANCE = dist;
              } else {
                gra.attributes = newAttr;
              }
              results.push(gra);
            }
          }
        }
        this._processResults(results);
      }));
    },

    // process results
    _processResults: function (results) {
      this.container.innerHTML = "";
      domClass.remove(this.container, "loading");
      this.graphicsLayer.clear();

      if (results.length === 0 && this.buffer) {
        this.container.innerHTML = this.parent.nls.noFeaturesFound;
        return;
      } else if (results.length === 0 && !this.buffer) {
        this.container.innerHTML = this.parent.nls.defaultTabMsg;
      }
      results.sort(this._compareDistance);

      var numberOfDivs = results.length + 1;
      var tpc = domConstruct.create("div", {
        style: "width:" + ((numberOfDivs * 220) + 20) + "px;"
      }, this.container);

      domClass.add(tpc, "SAT_tabPanelContent");

      var div_results_extra = domConstruct.create("div", {}, tpc);
      domClass.add(div_results_extra, "SATcol");

      var div_exp = domConstruct.create("div", {
        innerHTML: this.parent.nls.downloadCSV
      }, div_results_extra);
      domClass.add(div_exp, "btnExport");
      on(div_exp, "click", lang.hitch(this, this._exportToCSV, results));

      var unit = this.parent.config.distanceUnits;
      var units = this.parent.nls[unit];
      //var dFormat = null;

      var displayFields;
      if(typeof(this.tab.advStat) !== 'undefined') {
        displayFields = this.tab.advStat.stats.outFields;
      } else {
        displayFields = [];
        if (this.tab.tabLayers.length > 0) {
          var mapLayers = this.tab.tabLayers;
          array.forEach(mapLayers, lang.hitch(this, function (layer) {
            //if (layer.title === this.tab.layers || layer.name === this.tab.layers) {
            if(typeof(layer.popupInfo) !== 'undefined') {
              array.forEach(layer.popupInfo.fieldInfos, lang.hitch(this, function (field) {
                if (field.visible) {
                  var fieldObj = {};
                  fieldObj.value = 0;
                  fieldObj.expression = field.fieldName;
                  fieldObj.label = field.label;
                  displayFields.push(fieldObj);
                }
              }));
            } else if (layer.infoTemplate) {
              array.forEach(layer.infoTemplate.info.fieldInfos, lang.hitch(this, function (field) {
                if (field.visible) {
                  var fieldObj = {};
                  fieldObj.value = 0;
                  fieldObj.expression = field.fieldName;
                  fieldObj.label = field.label;
                  displayFields.push(fieldObj);
                }
              }));
            }
            else {
              var l = layer.layerObject ? layer.layerObject : layer;
              array.forEach(l.fields, lang.hitch(this, function(field) {
                var fieldObj = {};
                fieldObj.value = 0;
                fieldObj.expression = field.name;
                fieldObj.label = field.alias;
                displayFields.push(fieldObj);
              }));
            }
            //}
          }));
        }
      }
      var resultWidth = 0;
      for (var i = 0; i < results.length; i++) {
        var num = i + 1;
        var gra = results[i];
        var geom = gra.geometry;
        var loc = geom;
        if (geom.type !== "point") {
          loc = geom.getExtent().getCenter();
        }
        var attr = gra.attributes;
        var distLbl;
        if (this.incident.geometry.type === "point") {
          var dist = attr.DISTANCE;
          distLbl = units + ": " + Math.round(dist * 100) / 100;
        }
        var info = "";
        var c = 0;
        for (var prop in attr) {
          if (prop !== "DISTANCE" && c < 3) {
            if (typeof (displayFields) !== 'undefined') {
              for (var ij = 0; ij < displayFields.length; ij++) {
                var field = displayFields[ij];
                if (field.expression === prop) {
                  var fVal = this._getFieldValue(prop, attr[prop]);
                  var value;
                  if (typeof (fVal) !== 'undefined' && fVal !== null) {
                    value = utils.stripHTML(fVal.toString());
                  }else{
                    value = "";
                  }
                  var label;
                  if (gra._layer && gra._layer.fields) {
                    var cF = this._getField(gra._layer.fields, prop);
                    if (cF) {
                      label = cF.alias;
                    }
                  }
                  if (typeof (label) === 'undefined' || label in ['', ' ', null, undefined]) {
                    label = prop;
                  }
                  if (this.isURL(value)) {
                    value = '<a href="' + value + '" target="_blank" style="color: inherit;">' + label + '</a>';
                  } else if (this.isEmail(value)) {
                    value = '<a href="mailto:' + value + '" style="color: inherit;">' + label + '</a>';
                  }
                  info += (value + "<br/>");
                  c += 1;
                }
              }
            }
          }
        }

        var div = domConstruct.create("div", {}, tpc);
        domClass.add(div, "SATcolRec");

        var div1 = domConstruct.create("div", {}, div);
        domClass.add(div1, "SATcolRecBar");

        var div2 = domConstruct.create("div", {
          innerHTML: num
        }, div1);
        domClass.add(div2, "SATcolRecNum");
        domStyle.set(div2, "backgroundColor", this.parent.config.color);
        on(div2, "click", lang.hitch(this, this._zoomToLocation, loc));

        if (distLbl) {
          var div3 = domConstruct.create("div", {
            innerHTML: distLbl
          }, div1);
          domClass.add(div3, "SATcolDistance");
        }

        if (this.parent.config.enableRouting) {
          var div4 = domConstruct.create("div", { title: this.parent.nls.get_directions }, div1);
          domClass.add(div4, "SATcolDir");
          on(div4, "click", lang.hitch(this, this._routeToIncident, loc));
        }

        var div5 = domConstruct.create("div", {
          'class': 'SATcolWrap',
          innerHTML: info
        }, div);
        domClass.add(div5, "SATcolInfo");

        resultWidth += div.clientWidth;

        var sls = new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID,
          new Color.fromString(this.parent.config.color), 1);
        var sms = new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_CIRCLE, 24, sls,
          new Color.fromString(this.parent.config.color));
        var fnt = new Font();
        fnt.family = "Arial";
        fnt.size = "12px";
        var symText = new TextSymbol(num, fnt, "#ffffff");
        symText.setOffset(0, -4);
        this.graphicsLayer.add(new Graphic(loc, sms, attr));
        this.graphicsLayer.add(new Graphic(loc, symText, attr));
        //this._graphics.push(new Graphic(loc, sms, attr));
        //this._graphics.push(new Graphic(loc, symText, attr));
      }

      domStyle.set(tpc, 'width', ((resultWidth + 240) + numberOfDivs) + 'px');
    },

    //WORKS but is slightly different than Summary and grouped...in many cases the results would be the same but I think there could be a...
    //possibility of there being a difference...only keeping in case the group doesn't like the default jimu date format
    //_exportToCSV: function (results) {
    //  if (results.length === 0) {
    //    return false;
    //  }
    //  var name;
    //  if(this.tab.label){
    //    name = this.tab.label;
    //  }else{
    //    name = this.tab.layers;
    //  }
    //  var data = [];
    //  var cols = [];
    //  array.forEach(results, lang.hitch(this, function (gra) {
    //    var formatVals = lang.clone(gra.attributes);
    //    for (var field in gra.attributes) {
    //      if (this.specialFields && this.specialFields.hasOwnProperty(field)) {
    //        formatVals[field] = this._getFieldValue(field, gra.attributes[field]);
    //      }
    //    }
    //    data.push(formatVals);
    //  }));
    //  for (var prop in data[0]) {
    //    cols.push(prop);
    //  }
    //  CSVUtils.exportCSV(name, data, cols);
    //},

    _exportToCSV: function (results) {
      if (results.length === 0) {
        return false;
      }
      var name;
      if (this.tab.label) {
        name = this.tab.label;
      } else {
        name = this.tab.layers;
      }
      var data = [];
      var cols = [];
      array.forEach(results, function (gra) {
        data.push(gra.attributes);
      });
      for (var prop in data[0]) {
        cols.push(prop);
      }

      this.summaryLayer = this.tab.tabLayers[0];

      var fields = this.summaryLayer.fields;
      if (this.summaryLayer && this.summaryLayer.loaded && fields) {
        var options = {};
        if (this.parent.opLayers && this.parent.opLayers._layerInfos) {
          var layerInfo = this.parent.opLayers.getLayerInfoById(this.summaryLayer.id);
          if (layerInfo) {
            options.popupInfo = layerInfo.getPopupInfo();
          }
        }
        var _outFields = [];
        cols_loop:
          for (var ii = 0; ii < cols.length; ii++) {
            var col = cols[ii];
            var found = false;
            var field;
            fields_loop:
              for (var iii = 0; iii < fields.length; iii++) {
                field = fields[iii];
                if (field.name === col) {
                  found = true;
                  break fields_loop;
                }
              }
            if (found) {
              _outFields.push(field);
            } else {
              _outFields.push({
                'name': col,
                alias: col,
                show: true,
                type: "esriFieldTypeString"
              });
            }
          }

        options.datas = data;
        options.fromClient = false;
        options.withGeometry = false;
        options.outFields = _outFields;
        options.formatDate = true;
        options.formatCodedValue = true;
        options.formatNumber = false;
        CSVUtils.exportCSVFromFeatureLayer(name, this.summaryLayer, options);
      } else {
        //This does not handle value formatting
        CSVUtils.exportCSV(name, data, cols);
      }
    },

    _getField: function (fields, v) {
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f.name === v || f.alias === v) {
          return f;
        }
      }
      return undefined;
    },

    // getFields
    _getFields: function (layer) {
      var fields = [];
      if (this.tab.advStat && this.tab.advStat.stats &&
        this.tab.advStat.stats.outFields &&
        this.tab.advStat.stats.outFields.length > 0) {
        array.forEach(this.tab.advStat.stats.outFields, function (obj) {
          fields.push(obj.expression);
        });
      } else {
        var fldInfos;
        if (layer.infoTemplate) {
          fldInfos = layer.infoTemplate.info.fieldInfos;
        } else if (this.parent.map.itemInfo.itemData.operationalLayers.length > 0) {
          var mapLayers = this.parent.map.itemInfo.itemData.operationalLayers;
          fldInfos = null;
          mapServiceLayerLoop:
            for (var i = 0; i < mapLayers.length; i++) {
              var lyr = mapLayers[i];
              if (lyr.layerType === "ArcGISMapServiceLayer") {
                if (typeof (lyr.layers) !== 'undefined') {
                  for (var ii = 0; ii < lyr.layers.length; ii++) {
                    var sl = lyr.layers[ii];
                    if (sl.popupInfo) {
                      if (sl.id === layer.layerId) {
                        fldInfos = sl.popupInfo.fieldInfos;
                        break mapServiceLayerLoop;
                      }
                    }
                  }
                }
              }
            }
          if (!fldInfos) {
            fldInfos = layer.fields;
          }
        } else {
          fldInfos = layer.fields;
        }
        for (var j = 0; j < fldInfos.length; j++) {
          var fld = fldInfos[j];
          if (typeof (fld.visible) !== 'undefined') {
            if (fld.visible) {
              fields.push(fld.fieldName);
            }
          } else {
            fields.push(fld.name);
          }
        }
      }
      // special fields: dates and domains
      var spFields = {};
      array.forEach(layer.fields, lang.hitch(this, function (fld) {
        if (fld.type === "esriFieldTypeDate" || fld.domain) {
          if (fld.type === "esriFieldTypeDate") {
            if (layer.infoTemplate) {
              for (var key in layer.infoTemplate._fieldsMap) {
                if (typeof (layer.infoTemplate._fieldsMap[key].fieldName) !== 'undefined') {
                  if (layer.infoTemplate._fieldsMap[key].fieldName === fld.name) {
                    if (typeof (layer.infoTemplate._fieldsMap[key].format.dateFormat) !== 'undefined') {
                      this.dateFields[fld.name] = layer.infoTemplate._fieldsMap[key].format.dateFormat;
                    }
                  }
                }
              }
            }
          }
          spFields[fld.name] = fld;
        }
      }));
      this.specialFields = spFields;
      return fields;
    },

    // get field value
    _getFieldValue: function (fldName, fldValue) {
      var value = fldValue;
      if (this.specialFields[fldName]) {
        var fld = this.specialFields[fldName];
        if (fld.type === "esriFieldTypeDate") {
          var _f;
          if (this.dateFields[fldName] !== 'undefined') {
            var dFormat = this.dateFields[fldName];
            if (typeof (dFormat) !== undefined) {
              _f = { dateFormat: dFormat };
            } else {
              _f = { dateFormat: 'longMonthDayYear' };
            }
          } else {
            _f = { dateFormat: 'longMonthDayYear' };
          }
          value = utils.fieldFormatter.getFormattedDate(new Date(fldValue), _f);
        } else {
          var codedValues = fld.domain.codedValues;
          array.some(codedValues, function (obj) {
            if (obj.code === fldValue) {
              value = obj.name;
              return true;
            }
          });
        }
      }
      return value;
    },

    isURL: function (v) {
      return /(https?:\/\/|ftp:)/g.test(v);
    },

    isEmail: function (v) {
      return /\S+@\S+\.\S+/.test(v);
    },

    // get distance
    _getDistance: function (geom1, geom2) {
      var dist = 0;
      var units = this.parent.config.distanceUnits;
      dist = geometryEngine.distance(geom1, geom2, 9001);
      switch (units) {
        case "miles":
          dist *= 0.000621371;
          break;
        case "kilometers":
          dist *= 0.001;
          break;
        case "feet":
          dist *= 3.28084;
          break;
        case "yards":
          dist *= 1.09361;
          break;
        case "nauticalMiles":
          dist *= 0.000539957;
          break;
      }
      return dist;
    },

    // COMPARE DISTANCE
    _compareDistance: function (a, b) {
      if (a.attributes.DISTANCE < b.attributes.DISTANCE) {
        return -1;
      }
      if (a.attributes.DISTANCE > b.attributes.DISTANCE) {
        return 1;
      }
      return 0;
    },

    // zoom to location
    _zoomToLocation: function (loc) {
      this.parent.zoomToLocation(loc);
    },

    // route to incident
    _routeToIncident: function (loc) {
      this.parent.routeToIncident(loc);
    }
  });

  return proximityInfo;

});

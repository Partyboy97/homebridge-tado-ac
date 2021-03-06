var Service;
var Characteristic;

var https = require('https'),
    assign = require('object-assign');

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;
    HomebridgeAPI = homebridge;
    homebridge.registerAccessory('homebridge-tado-ac', 'TADO', TadoAccessory);
}


function TadoAccessory(log, config) {
    var accessory = this;
    this.log = log;
    this.storage = require('node-persist');
    this.name = config['name'];
    this.homeID = config['homeID'];
    this.username = config['username'];
    this.password = encodeURIComponent(config['password']);
    this.zone = config['zone'] || 1;
    this.maxValue = config['maxValue'] || 31;
    this.minValue = config['minValue'] || 16;
    this.useFahrenheit = config['useFahrenheit'];
    this.useSwing = config['useSwing'] || false; // can get values: "ON" or "OFF"
    this.useFanSpeed = config['useFanSpeed'] || false; // can get values: "LOW", "MIDDLE", "HIGH" or "AUTO" depend on your aircon
    this.tadoMode = config['tadoMode'] || "MANUAL";
    this.zoneMode = "UNKNOWN";
    
    //Init storage
      this.storage.initSync({
        dir: HomebridgeAPI.user.persistPath()
      });
    this.lastMode = this.storage.getItem(this.name) || "";
    this.lastTemp = this.storage.getItem(this.name + "_lastTemp");
    if (!this.lastTemp) {
        
        if (this.useFahrenheit){
            this.lastTemp = 77;
        } else {
            this.lastTemp = 25;
        }
        this.storage.setItem(this.name + "_lastTemp", this.lastTemp);
    }
   
    
    //Get Token
     var tokenOptions = {
            host: 'my.tado.com',
            path: '/oauth/token?client_id=tado-web-app&client_secret=wZaRN7rpjn3FoNyF5IFuxg9uMzYJcvOoQ8QWiIqS3hfk6gLhVlG57j5YNoZL2Rtc&grant_type=password&password=' + this.password + '&scope=home.user&username=' + this.username,
            method: 'POST'
    };
    https.request(tokenOptions, function(response){
        var strData = '';
        response.on('data', function(chunk) {
            strData += chunk;
        });
        response.on('end', function() {
            //accessory.log("strData:" + strData);
            try {
                var tokenObj = JSON.parse(strData);
            }
            catch(e){
                accessory.log("couldn't retrieve new Token, error:" + e);
            }
            var lastToken = accessory.storage.getItem('Tado_Token');
            if (lastToken !== tokenObj.access_token && tokenObj.access_token !== undefined) {
                accessory.storage.setItem('Tado_Token', tokenObj.access_token);
            }
        });
        setInterval(function(response){
            https.request(tokenOptions, function(response){
                var strData = '';
                response.on('data', function(chunk) {
                    strData += chunk;
                });
                response.on('end', function() {
                    try {
                        var tokenObj = JSON.parse(strData);
                    }
                    catch(e){
                        accessory.log("couldn't retrieve new Token, error:" + e);
                    }
                    var lastToken = accessory.storage.getItem('Tado_Token');
                    if (lastToken !== tokenObj.access_token && tokenObj.access_token !== undefined) {
                        accessory.storage.setItem('Tado_Token', tokenObj.access_token);
                    }
                });
            }).end();
        }, 500000)
    }).end();
}

TadoAccessory.prototype.getServices = function() {
    var accessory = this;
    var minValue = accessory.minValue;
    var maxValue = accessory.maxValue;


    this.log("Minimum setpoint " + minValue);
    this.log("Maximum setpoint " + maxValue);

    if (this.useFahrenheit) {
        minValue = Math.round((accessory.minValue - 32) * 5 / 9);
        maxValue = Math.round((accessory.maxValue - 32) * 5 / 9);
    }

    var informationService = new Service.AccessoryInformation()
        .setCharacteristic(Characteristic.Manufacturer, 'Tado GmbH')
        .setCharacteristic(Characteristic.Model, 'Tado Smart Heating / AC Control')
        .setCharacteristic(Characteristic.SerialNumber, 'Tado Serial Number');

    this.service = new Service.Thermostat(this.name);
        
    this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .on('get', this.getCurrentHeatingCoolingState.bind(this));

    this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .on('get', this.getTargetHeatingCoolingState.bind(this))
        .on('set', this.setTargetHeatingCoolingState.bind(this));

    this.service.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({
            minValue: 0,
            maxValue: 100,
            minStep: 0.01
        })
        .on('get', this.getCurrentTemperature.bind(this));

    this.service.getCharacteristic(Characteristic.TargetTemperature)
        .setProps({
            minValue: minValue,
            maxValue: maxValue,
            minStep: 1
        })
        .on('get', this.getTargetTemperature.bind(this))
        .on('set', this.setTargetTemperature.bind(this));

    this.service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
        .on('get', this.getTemperatureDisplayUnits.bind(this));

    this.service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .setProps({
            minValue: 0,
            maxValue: 100,
            minStep: 0.01
        })
        .on('get', this.getCurrentRelativeHumidity.bind(this));

    this.service.addCharacteristic(Characteristic.On)
        .on('get', this.getTargetHeatingCoolingState.bind(this))
        .on('set', this.setTargetHeatingCoolingState.bind(this));

    return [informationService, this.service];
}

TadoAccessory.prototype.getCurrentHeatingCoolingState = function(callback) {
    var accessory = this;
    accessory.lastMode = accessory.storage.getItem(accessory.name);
    accessory._getCurrentStateResponse(function(response) {
        var str = '';

        //another chunk of data has been recieved, so append it to `str`
        response.on('data', function(chunk) {
            str += chunk;
        });

        //the whole response has been recieved, so we just print it out here
        response.on('end', function() {
            var obj = JSON.parse(str);
            //accessory.log("obj = " + JSON.stringify(obj));
            accessory.log("Current zone mode is " + obj.setting.mode);
            accessory.log("Current power state is " + obj.setting.power);
            if (obj != null && obj.setting != null) {
                accessory.zoneMode = obj.setting.mode;

                if (obj.setting.temperature != null) {
                    if (accessory.useFahrenheit) {
                        accessory.log("Target temperature is " + obj.setting.temperature.fahrenheit + "ºF");
                    } else {
                        accessory.log("Target temperature is " + obj.setting.temperature.celsius + "ºC");
                    }
                }
            }
            if (JSON.stringify(obj.setting.power).match("OFF")) {
                accessory.log("Current operating state is OFF");
                callback(null, Characteristic.CurrentHeatingCoolingState.OFF);
            }
            else if (!obj.overlay) {
                    accessory.log("current operating state is AUTO");
                    callback(null, Characteristic.CurrentHeatingCoolingState.AUTO);

            } 
            else {
                    if (JSON.stringify(obj.setting.mode).match("HEAT")) {
                        if (accessory.lastMode !== "HEAT") {
                            accessory.storage.setItem(accessory.name, "HEAT");
                        };
                        callback(null, Characteristic.CurrentHeatingCoolingState.HEAT);
                    } else if (JSON.stringify(obj.setting.mode).match("COOL")) {
                        if (accessory.lastMode !== "COOL") {
                            accessory.storage.setItem(accessory.name, "COOL");                            
                        };
                        callback(null, Characteristic.CurrentHeatingCoolingState.COOL);
                    } else {
                        callback(null, Characteristic.CurrentHeatingCoolingState.OFF);
                    }
            }
        });
    });
}

TadoAccessory.prototype.getTargetHeatingCoolingState = function(callback) {
    var accessory = this;  
   
    accessory._getCurrentStateResponse(function(response) {
        var str = '';

        //another chunk of data has been recieved, so append it to `str`
        response.on('data', function(chunk) {
            str += chunk;
        });

        //the whole response has been recieved, so we just print it out here
        response.on('end', function() {
            var obj = JSON.parse(str);
            //accessory.log("obj = " + JSON.stringify(obj));
            if (obj != null && obj.setting != null && obj.setting.temperature != null) {
                if (accessory.useFahrenheit) {
                    accessory.log("Target temperature is " + obj.setting.temperature.fahrenheit + "ºF");
                } else {
                    accessory.log("Target temperature is " + obj.setting.temperature.celsius + "ºC");
                }
            }

            if (JSON.stringify(obj.setting.power).match("OFF")) {
                accessory.log("Target operating state is OFF");
                callback(null, Characteristic.CurrentHeatingCoolingState.OFF);
            }
            else if (!obj.overlay) {
                    accessory.log("Target operating state is AUTO");
                    accessory.log("Target operating mode is " + obj.setting.mode);
                    if (JSON.stringify(obj.setting.mode).match("HEAT")) {
                        callback(null, Characteristic.TargetHeatingCoolingState.HEAT);
                    } else if (JSON.stringify(obj.setting.mode).match("COOL")) {
                        callback(null, Characteristic.TargetHeatingCoolingState.COOL);
                    } else {
                        callback(null, Characteristic.CurrentHeatingCoolingState.OFF);
                    }
            } 
            else {
                    accessory.log("Target operating state is " + obj.setting.mode);
                    if (JSON.stringify(obj.setting.mode).match("HEAT")) {
                        callback(null, Characteristic.TargetHeatingCoolingState.HEAT);
                    } 
                    else if (JSON.stringify(obj.setting.mode).match("COOL")) {
                        callback(null, Characteristic.TargetHeatingCoolingState.COOL);
                    } else {
                        callback(null, Characteristic.CurrentHeatingCoolingState.OFF);
                    }
            }
        });
    });      
}

TadoAccessory.prototype.setTargetHeatingCoolingState = function(state, callback) {
    var accessory = this;
    accessory.lastTemp = accessory.storage.getItem(accessory.name + "_lastTemp");
    accessory.lastMode = accessory.storage.getItem(accessory.name);
    if (state === 0) {
        accessory.log("Set target state to off");

        var body = {
            "termination": {
            },
            "setting": {
                "power": "OFF",
                "type": "AIR_CONDITIONING"
            }
        };
        body.termination.type = accessory.tadoMode
        accessory.service.setCharacteristic(Characteristic.CurrentHeatingCoolingState, Characteristic.CurrentHeatingCoolingState.OFF);        
        accessory._setOverlay(body);
    }  
    
    else if (state === 1) {
        accessory.log("Force heating");
        accessory.storage.setItem(accessory.name, "HEAT");
        if (accessory.useFahrenheit){
                accessory.service.setCharacteristic(Characteristic.TargetTemperature, Math.round((accessory.lastTemp - 32) * 5 / 9));
            } else {
                accessory.service.setCharacteristic(Characteristic.TargetTemperature, accessory.lastTemp);
            }
        //accessory._setTargetHeatingOverlay(accessory.lastTemp);
    }

    else if (state === 2) {
            accessory.log("Force cooling");
            accessory.storage.setItem(accessory.name, "COOL");
            if (accessory.useFahrenheit){
                accessory.service.setCharacteristic(Characteristic.TargetTemperature, Math.round((accessory.lastTemp - 32) * 5 / 9));
            } else {
                accessory.service.setCharacteristic(Characteristic.TargetTemperature, accessory.lastTemp);
            }
            //accessory._setTargetCoolingOverlay(accessory.lastTemp);
    }

    else if (state === 3) {
            accessory.log("Automatic control");
            accessory._setOverlay(null);
            accessory.service.setCharacteristic(Characteristic.CurrentHeatingCoolingState, Characteristic.CurrentHeatingCoolingState.AUTO);  
    }
    
    else if (state === false) {
        accessory.log("Set target state to off");

        var body = {
            "termination": {
            },
            "setting": {
                "power": "OFF",
                "type": "AIR_CONDITIONING"
            }
        };
        body.termination.type = accessory.tadoMode
        accessory.service.setCharacteristic(Characteristic.CurrentHeatingCoolingState, Characteristic.CurrentHeatingCoolingState.OFF);        
        accessory._setOverlay(body);
    }
            
     else {
        switch (accessory.lastMode) {
            case "HEAT":
                accessory.log("Turn ON with Heating");
                //accessory.storage.setItem(accessory.name, "HEAT");
                // accessory._setTargetHeatingOverlay(accessory.lastTemp);
                if (accessory.useFahrenheit){
                    accessory.service.setCharacteristic(Characteristic.TargetTemperature, Math.round((accessory.lastTemp - 32) * 5 / 9));
                } else {
                    accessory.service.setCharacteristic(Characteristic.TargetTemperature, accessory.lastTemp);
                }
                break;

            case "COOL":
                accessory.log("Turn ON with Cooling");
                //accessory.storage.setItem(accessory.name, "COOL");
                // accessory._setTargetCoolingOverlay(accessory.lastTemp);
                if (accessory.useFahrenheit){
                    accessory.service.setCharacteristic(Characteristic.TargetTemperature, Math.round((accessory.lastTemp - 32) * 5 / 9));
                } else {
                    accessory.service.setCharacteristic(Characteristic.TargetTemperature, accessory.lastTemp);
                }
                break;
        }
    }
          
    callback(null);
}

TadoAccessory.prototype.getCurrentTemperature = function(callback) {
    var accessory = this;

    accessory._getCurrentStateResponse(function(response) {
        var str = '';

        //another chunk of data has been recieved, so append it to `str`
        response.on('data', function(chunk) {
            str += chunk;
        });

        //the whole response has been recieved, so we just print it out here
        response.on('end', function() {
            var obj = JSON.parse(str);
            //accessory.log("obj = " + JSON.stringify(obj));
            if ( !obj.sensorDataPoints.insideTemperature || obj.sensorDataPoints.insideTemperature == undefined) {
                accessory.log("Couldn't retrieve current temperature");
                callback(null);
            }
            else {
                if (accessory.useFahrenheit) {
                    accessory.log("Room temperature is " + obj.sensorDataPoints.insideTemperature.fahrenheit + "ºF");
                    callback(null, obj.sensorDataPoints.insideTemperature.celsius);
                } else {
                    accessory.log("Room temperature is " + obj.sensorDataPoints.insideTemperature.celsius + "ºC");
                    callback(null, obj.sensorDataPoints.insideTemperature.celsius);
                }
            }
        });
    });
}

TadoAccessory.prototype.getTargetTemperature = function(callback) {
    var accessory = this;

    accessory._getCurrentStateResponse(function(response) {
        var str = '';

        //another chunk of data has been recieved, so append it to `str`
        response.on('data', function(chunk) {
            str += chunk;
        });

        //the whole response has been recieved, so we just print it out here
        response.on('end', function() {
            var obj = JSON.parse(str);
            //accessory.log("obj = " + JSON.stringify(obj));
            if (obj.setting == undefined || obj.setting.temperature == null) {
                    accessory.log("Target temperature is unavailable");
                    callback(null, null);
                    return;
            }
            else if (accessory.useFahrenheit) {
                    accessory.log("Target temperature is " + obj.setting.temperature.fahrenheit + "ºF");
                    accessory.storage.setItem(accessory.name + "_lastTemp", obj.setting.temperature.fahrenheit);
                    callback(null, obj.setting.temperature.celsius);
            } else {
                    accessory.log("Target temperature is " + obj.setting.temperature.celsius + "ºC");
                    accessory.storage.setItem(accessory.name + "_lastTemp", obj.setting.temperature.celsius);
                    callback(null, obj.setting.temperature.celsius);
            }
        });
    });
}

TadoAccessory.prototype.setTargetTemperature = function(temp, callback) {
    var accessory = this;
    accessory.lastMode = accessory.storage.getItem(accessory.name);
    if (temp !== null) {
        if (accessory.useFahrenheit) {
            accessory.log("Set target temperature to " + Math.round(temp*9/5+32) + "º");
            accessory.storage.setItem(accessory.name + "_lastTemp", Math.round(temp*9/5+32));
            temp = Math.round(temp*9/5+32);
        } else {
            accessory.log("Set target temperature to " + temp + "º");
            accessory.storage.setItem(accessory.name + "_lastTemp", temp);
        }
        switch (accessory.lastMode) {
            case "COOL":
                accessory._setTargetCoolingOverlay(temp);
                break;

            case "HEAT":
                accessory._setTargetHeatingOverlay(temp);
                break;
        }
    }
    callback(null);
}

TadoAccessory.prototype.getTemperatureDisplayUnits = function(callback) {
    var accessory = this;
    accessory.log("The current temperature display unit is " + (accessory.useFahrenheit ? "ºF" : "ºC"));
    callback(null, accessory.useFahrenheit ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT : Characteristic.TemperatureDisplayUnits.CELSIUS);
}

TadoAccessory.prototype.getCurrentRelativeHumidity = function(callback) {
    var accessory = this;

    accessory._getCurrentStateResponse(function(response) {
        var str = '';

        //another chunk of data has been recieved, so append it to `str`
        response.on('data', function(chunk) {
            str += chunk;
        });

        //the whole response has been recieved, so we just print it out here
        response.on('end', function() {
            var obj = JSON.parse(str);
            accessory.log("Humidity is " + obj.sensorDataPoints.humidity.percentage + "%");
            callback(null, obj.sensorDataPoints.humidity.percentage);
        });
    });
}


TadoAccessory.prototype._getCurrentStateResponse = function(callback) {
    var accessory = this;
    //accessory.log("Getting target state");
    var lastToken = accessory.storage.getItem('Tado_Token');
    var options = {
        host: 'my.tado.com',
        path: '/api/v2/homes/' + accessory.homeID + '/zones/' + accessory.zone + '/state',
        headers: {
            Authorization: 'Bearer ' + lastToken
        }
    };
    https.request(options, callback).end();
}

TadoAccessory.prototype._setOverlay = function(body) {
    var accessory = this;
    //accessory.log("Setting new overlay");
    var lastToken = accessory.storage.getItem('Tado_Token');
    var options = {
        host: 'my.tado.com',
        path: '/api/v2/homes/' + accessory.homeID + '/zones/' + accessory.zone + '/overlay?username=' + accessory.username + '&password=' + accessory.password,
        method: body == null ? 'DELETE' : 'PUT',
        headers: {
            Authorization: 'Bearer ' + lastToken
        }
    };
    
    if (body != null) {
        body = JSON.stringify(body);
        //accessory.log("zone: " + accessory.zone + ",  body: " + body);
    }
    
    https.request(options, null).end(body);  
}

TadoAccessory.prototype._setTargetCoolingOverlay = function(temp) {
    var accessory = this;
    var body = {
        "termination": {
        },
        "setting": {
            "power": "ON",
            "type": "AIR_CONDITIONING",
            "mode": "COOL",
            "temperature": {}
        } 
    };
    body.termination.type = this.tadoMode;
    if (this.useFahrenheit) {
        body.setting.temperature.fahrenheit = temp;
    } else {
        body.setting.temperature.celsius = temp;
    }
    if (this.useFanSpeed){
        body.setting.fanSpeed = this.useFanSpeed;
    }
    if (this.useSwing){
        body.setting.swing = this.useSwing;
    }
    accessory.service.setCharacteristic(Characteristic.CurrentHeatingCoolingState, Characteristic.CurrentHeatingCoolingState.COOL);
     
    this._setOverlay(body);
}

TadoAccessory.prototype._setTargetHeatingOverlay = function(temp) {
    var accessory = this;
    var body = {
        "termination": {
        },
        "setting": {
            "power": "ON",
            "type": "AIR_CONDITIONING",
            "mode": "HEAT",
            "temperature": {}
        }
    };
    
    body.termination.type = this.tadoMode;
    if (this.useFahrenheit) {
        body.setting.temperature.fahrenheit = temp;
    } else {
        body.setting.temperature.celsius = temp;
    }
    if (this.useFanSpeed){
        body.setting.fanSpeed = this.useFanSpeed;
    }
    if (this.useSwing){
        body.setting.swing = this.useSwing;
    }
    accessory.service.setCharacteristic(Characteristic.CurrentHeatingCoolingState, Characteristic.CurrentHeatingCoolingState.HEAT);
    
    this._setOverlay(body);
}

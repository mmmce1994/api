'use strict';

var request = require('request');

function CurrencyController(options) {
  this.node = options.node;
  var refresh = options.currencyRefresh || CurrencyController.DEFAULT_CURRENCY_DELAY;
  this.currencyDelay = refresh * 60000;
  this.bitstampRate = 0;
  this.timestamp = Date.now();
}

CurrencyController.DEFAULT_CURRENCY_DELAY = 10;

CurrencyController.prototype.index = function(req, res) {
  var self = this;
  var currentTime = Date.now();
  if (self.bitstampRate === 0 || currentTime >= (self.timestamp + self.currencyDelay)) {
    self.timestamp = currentTime;
    var utb_to_btc = 0;
    var btc_to_usd = 0;

    request('https://bitpay.com/rates', function(err, response, body) {
        if (err) {
            self.node.log.error(err);
        }
        if (!err && response.statusCode === 200) {
            btc_to_usd = parseFloat(JSON.parse(body).data[0].rate);
        }
    });

    request('https://novaexchange.com/remote/v2/market/info/BTC_UTB/', function(err, response, body) {
        if (err) {
          self.node.log.error(err);
        }
        if (!err && response.statusCode === 200) {
          utb_to_btc = parseFloat(JSON.parse(body).markets[0].last_price);
        }

        res.jsonp({
            status: 200,
            data: {
                bitstamp: utb_to_btc * btc_to_usd
            }
        });

    });



  } else {
    res.jsonp({
      status: 200,
      data: { 
        bitstamp: self.bitstampRate 
      }
    });
  }

};

module.exports = CurrencyController;

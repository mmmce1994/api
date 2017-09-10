'use strict';

var expect = require('chai').expect;
var spawn = require('child_process').spawn;
var rimraf = require('rimraf');
var mkdirp = require('mkdirp');
var fs = require('fs');
var async = require('async');
var RPC = require('bitcoind-rpc');
var http = require('http');
var bitcore = require('bitcore-lib');
var PrivateKey = bitcore.PrivateKey;
var Transaction = bitcore.Transaction;

var rpc1Address;
var rpc2Address;

var rpcConfig = {
  protocol: 'http',
  user: 'local',
  pass: 'localtest',
  host: '127.0.0.1',
  port: 58332,
  rejectUnauthorized: false
};

var rpc1 = new RPC(rpcConfig);
rpcConfig.port++;
var rpc2 = new RPC(rpcConfig);
var debug = true;
var bitcoreDataDir = '/tmp/bitcore';
var bitcoinDataDirs = ['/tmp/bitcoin1', '/tmp/bitcoin2'];

var bitcoin = {
  args: {
    datadir: null,
    listen: 1,
    regtest: 1,
    server: 1,
    rpcuser: 'local',
    rpcpassword: 'localtest',
    //printtoconsole: 1
    rpcport: 58332,
  },
  datadir: null,
  exec: 'bitcoind', //if this isn't on your PATH, then provide the absolute path, e.g. /usr/local/bin/bitcoind
  processes: []
};

var bitcore = {
  configFile: {
    file: bitcoreDataDir + '/bitcore-node.json',
    conf: {
      network: 'regtest',
      port: 53001,
      datadir: bitcoreDataDir,
      services: [
        'p2p',
        'db',
        'header',
        'block',
        'address',
        'transaction',
        'mempool',
        'web',
        'insight-api',
        'fee',
        'timestamp'
      ],
      servicesConfig: {
        'p2p': {
          'peers': [
            { 'ip': { 'v4': '127.0.0.1' }, port: 18444 }
          ]
        },
        'insight-api': {
          'routePrefix': 'api'
        }
      }
    }
  },
  httpOpts: {
    protocol: 'http:',
    hostname: 'localhost',
    port: 53001,
  },
  opts: { cwd: bitcoreDataDir },
  datadir: bitcoreDataDir,
  exec: 'bitcored',  //if this isn't on your PATH, then provide the absolute path, e.g. /usr/local/bin/bitcored
  args: ['start'],
  process: null
};

var startBitcoind = function(count, callback) {

  var listenCount = 0;
  async.timesSeries(count, function(n, next) {

    var datadir = bitcoinDataDirs.shift();

    bitcoin.datadir = datadir;
    bitcoin.args.datadir = datadir;

    if (listenCount++ > 0) {
      bitcoin.args.listen = 0;
      bitcoin.args.rpcport++;
      bitcoin.args.connect = '127.0.0.1';
    }

    rimraf(datadir, function(err) {

      if(err) {
        return next(err);
      }

      mkdirp(datadir, function(err) {

        if(err) {
          return next(err);
        }

        var args = bitcoin.args;
        var argList = Object.keys(args).map(function(key) {
          return '-' + key + '=' + args[key];
        });

        var bitcoinProcess = spawn(bitcoin.exec, argList, bitcoin.opts);
        bitcoin.processes.push(bitcoinProcess);

        bitcoinProcess.stdout.on('data', function(data) {

          if (debug) {
            process.stdout.write(data.toString());
          }

        });

        bitcoinProcess.stderr.on('data', function(data) {

          if (debug) {
            process.stderr.write(data.toString());
          }

        });

        next();

      });

    });
  }, function(err) {

      if (err) {
        return callback(err);
      }

      var pids = bitcoin.processes.map(function(process) {
        return process.pid;
      });

      console.log(count + ' bitcoind\'s started at pid(s): ' + pids);
      callback();
  });
};


var shutdownBitcoind = function(callback) {
  bitcoin.processes.forEach(function(process) {
    process.kill();
  });
  setTimeout(callback, 3000);
};

var shutdownBitcore = function(callback) {
  if (bitcore.process) {
    bitcore.process.kill();
  }
  callback();
};

var txid;
var buildInitialChain = function(callback) {
  async.waterfall([
    function(next) {
      console.log('checking to see if bitcoind\'s are connected to each other.');
      rpc1.getinfo(function(err, res) {
        if (err || res.result.connections !== 1) {
          next(err || new Error('bitcoind\'s not connected to each other.'));
        }
        next();
      });
    },
    function(next) {
      console.log('generating 101 blocks');
      rpc1.generate(101, next);
    },
    function(res, next) {
      console.log('getting new address from rpc2');
      rpc2.getNewAddress(function(err, res) {
        if (err) {
          return next(err);
        }
        rpc2Address = res.result;
        console.log(rpc2Address);
        next(null, rpc2Address);
      });
    },
    function(addr, next) {
      rpc1.sendToAddress(rpc2Address, 25, next);
    },
    function(res, next) {
      console.log('TXID: ' + res.result);
      console.log('generating 6 blocks');
      rpc1.generate(7, next);
    },
    function(res, next) {
      rpc2.getBalance(function(err, res) {
        console.log(res);
        next();
      });
    },
    function(next) {
      console.log('getting new address from rpc1');
      rpc1.getNewAddress(function(err, res) {
        if (err) {
          return next(err);
        }
        rpc1Address = res.result;
        next(null, rpc1Address);
      });
    },
    function(addr, next) {
      rpc2.sendToAddress(rpc1Address, 20, next);
    },
    function(res, next) {
      txid = res.result;
      console.log('sending from rpc2Address TXID: ', res);
      console.log('generating 6 blocks');
      rpc2.generate(6, next);
    }
  ], function(err) {

    if (err) {
      return callback(err);
    }
    rpc1.getInfo(function(err, res) {
      console.log(res);
      callback();
    });
  });

};

var startBitcore = function(callback) {

  rimraf(bitcoreDataDir, function(err) {

    if(err) {
      return callback(err);
    }

    mkdirp(bitcoreDataDir, function(err) {

      if(err) {
        return callback(err);
      }

      fs.writeFileSync(bitcore.configFile.file, JSON.stringify(bitcore.configFile.conf));

      var args = bitcore.args;
      bitcore.process = spawn(bitcore.exec, args, bitcore.opts);

      bitcore.process.stdout.on('data', function(data) {

        if (debug) {
          process.stdout.write(data.toString());
        }

      });
      bitcore.process.stderr.on('data', function(data) {

        if (debug) {
          process.stderr.write(data.toString());
        }

      });

      callback();
    });

  });


};

describe('Address', function() {

  this.timeout(60000);

  before(function(done) {

    async.series([
      function(next) {
        startBitcoind(2, next);
      },
      function(next) {
        setTimeout(function() {
          buildInitialChain(next);
        }, 8000);
      },
      function(next) {
        setTimeout(function() {
          startBitcore(next);
        }, 8000);
      }
    ], function(err) {
        if (err) {
          return done(err);
        }
        setTimeout(done, 2000);
    });

  });

  after(function(done) {
    shutdownBitcore(function() {
      shutdownBitcoind(done);
    });
  });



  it('should get address info correctly: /addr/:addr', function(done) {


    var request = http.request('http://localhost:53001/api/addr/' + rpc2Address, function(res) {

      var error;
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        if (error) {
          return;
        }
        return done('Error from bitcore-node webserver: ' + res.statusCode);
      }

      var resError;
      var resData = '';

      res.on('error', function(e) {
        resError = e;
      });

      res.on('data', function(data) {
        resData += data;
      });

      res.on('end', function() {
        if (error) {
          return;
        }
        var data = JSON.parse(resData);
        console.log(data);
        expect(data.balance).to.equal(0);
        expect(data.totalSent).to.equal(25);
        done();
      });

    });
    request.write('');
    request.end();
  });

  it('should get a utxo: /addr/:addr/utxo', function(done) {

    var request = http.request('http://localhost:53001/api/addr/' + rpc1Address + '/utxo', function(res) {

      var error;
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        if (error) {
          return;
        }
        return done('Error from bitcore-node webserver: ' + res.statusCode);
      }

      var resError;
      var resData = '';

      res.on('error', function(e) {
        resError = e;
      });

      res.on('data', function(data) {
        resData += data;
      });

      res.on('end', function() {
        if (error) {
          return;
        }
        var data = JSON.parse(resData);
        console.log(data);
        expect(data.length).equal(1);
        expect(data[0].amount).equal(20);
        expect(data[0].satoshis).equal(2000000000);
        expect(data[0].confirmations).equal(6);
        done();
      });

    });

    request.write('');
    request.end();

  });

  it('should get multi-address utxos: /addrs/:addrs/utxo', function(done) {

    var request = http.request('http://localhost:53001/api/addrs/' + rpc2Address + ',' + rpc1Address + '/utxo', function(res) {

      var error;
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        if (error) {
          return;
        }
        return done('Error from bitcore-node webserver: ' + res.statusCode);
      }

      var resError;
      var resData = '';

      res.on('error', function(e) {
        resError = e;
      });

      res.on('data', function(data) {
        resData += data;
      });

      res.on('end', function() {
        if (error) {
          return;
        }
        var data = JSON.parse(resData);
        console.log(data);
        expect(data.length).to.equal(1);
        expect(data[0].amount).to.equal(20);
        expect(data[0].satoshis).to.equal(2000000000);
        done();
      });

    });

    request.write('');
    request.end();

  });

  it('should post a utxo: /addrs/:addrs/utxo', function(done) {

    var body = JSON.stringify({
      addrs: [ rpc1Address, rpc2Address ]
    });

    var httpOpts = {
      hostname: 'localhost',
      port: 53001,
      path: '/api/addrs/utxo',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length
      }
    };

    var request = http.request(httpOpts, function(res) {

      var error;
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        if (error) {
          return;
        }
        return done('Error from bitcore-node webserver: ' + res.statusCode);
      }

      var resError;
      var resData = '';

      res.on('error', function(e) {
        resError = e;
      });

      res.on('data', function(data) {
        resData += data;
      });

      res.on('end', function() {
        if (error) {
          return;
        }
        var data = JSON.parse(resData);
        console.log(data);
        expect(data.length).to.equal(1);
        expect(data[0].amount).to.equal(20);
        expect(data[0].satoshis).to.equal(2000000000);
        done();
      });

    });

    request.write(body);
    request.end();

  });

  it('should get txs for a set of addresses: /addrs/:addrs/txs', function(done) {

    var httpOpts = {
      hostname: 'localhost',
      port: 53001,
      path: '/api/addrs/' + rpc1Address + ',' + rpc2Address + '/txs',
      method: 'GET'
    };

    var request = http.request(httpOpts, function(res) {

      var error;
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        if (error) {
          return;
        }
        return done('Error from bitcore-node webserver: ' + res.statusCode);
      }

      var resError;
      var resData = '';

      res.on('error', function(e) {
        resError = e;
      });

      res.on('data', function(data) {
        resData += data;
      });

      res.on('end', function() {
        if (error) {
          return;
        }
        var data = JSON.parse(resData);
        console.log(resData);
        expect(data.items.length).to.equal(3);
        expect(data.from).to.equal(0);
        expect(data.to).to.equal(3);
        done();
      });

    });

    request.write('');
    request.end();

  });

  it('should post txs for a set of addresses: /addrs/txs', function(done) {

    var body = JSON.stringify({
      addrs: [ rpc1Address, rpc2Address ]
    });

    var httpOpts = {
      hostname: 'localhost',
      port: 53001,
      path: '/api/addrs/txs',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    var request = http.request(httpOpts, function(res) {

      var error;
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        if (error) {
          return;
        }
        return done('Error from bitcore-node webserver: ' + res.statusCode);
      }

      var resError;
      var resData = '';

      res.on('error', function(e) {
        resError = e;
      });

      res.on('data', function(data) {
        resData += data;
      });

      res.on('end', function() {
        if (error) {
          return;
        }
        var data = JSON.parse(resData);
        console.log(resData);
        expect(data.items.length).to.equal(3);
        expect(data.from).to.equal(0);
        expect(data.to).to.equal(3);
        done();
      });

    });

    request.write(body);
    request.end();

  });

  it('should get totalReceived for an address: /addr/:addr/totalReceived', function(done) {

    var httpOpts = {
      hostname: 'localhost',
      port: 53001,
      path: '/api/addr/' + rpc1Address + '/totalReceived',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    var request = http.request(httpOpts, function(res) {

      var error;
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        if (error) {
          return;
        }
        return done('Error from bitcore-node webserver: ' + res.statusCode);
      }

      var resError;
      var resData = '';

      res.on('error', function(e) {
        resError = e;
      });

      res.on('data', function(data) {
        resData += data;
      });

      res.on('end', function() {

        if (error) {
          return;
        }

        var data = JSON.parse(resData);
        expect(data).to.equal(2000000000);
        done();
      });

    });

    request.write('');
    request.end();

  });

  it('should get totalSent for an address: /addr/:addr/totalSent', function(done) {

    var httpOpts = {
      hostname: 'localhost',
      port: 53001,
      path: '/api/addr/' + rpc1Address + '/totalSent',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    var request = http.request(httpOpts, function(res) {

      var error;
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        if (error) {
          return;
        }
        return done('Error from bitcore-node webserver: ' + res.statusCode);
      }

      var resError;
      var resData = '';

      res.on('error', function(e) {
        resError = e;
      });

      res.on('data', function(data) {
        resData += data;
      });

      res.on('end', function() {
        if (error) {
          return;
        }
        var data = JSON.parse(resData);
        expect(data).to.equal(0);
        done();
      });

    });

    request.write('');
    request.end();

  });

  it('should get unconfirmedBalance for an address: /addr/:addr/unconfirmedBalance', function(done) {

    var httpOpts = {
      hostname: 'localhost',
      port: 53001,
      path: '/api/addr/' + rpc1Address + '/unconfirmedBalance',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    var request = http.request(httpOpts, function(res) {

      var error;
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        if (error) {
          return;
        }
        return done('Error from bitcore-node webserver: ' + res.statusCode);
      }

      var resError;
      var resData = '';

      res.on('error', function(e) {
        resError = e;
      });

      res.on('data', function(data) {
        resData += data;
      });

      res.on('end', function() {
        if (error) {
          return;
        }
        var data = JSON.parse(resData);
        expect(data).to.equal(0);
        done();
      });

    });

    request.write('');
    request.end();

  });

  it('should index addresses correctly', function(done) {
    // if we send a tx that has an address in both the input and the output, does it index correctly?
   var txid;
   var pk1;
   var tx;
    async.waterfall([
      function(next) {
        rpc1.listUnspent(function(err, res) {

          if (err) {
            return next(err);
          }

          next(null, res.result[0]);

        });
      },
      function(utxo, next) {
        rpc1.dumpPrivKey(utxo.address, function(err, res) {
          if (err) {
            return next(err);
          }
          var pk = new PrivateKey(res.result);
          pk1 = new PrivateKey('testnet');
          var change = new PrivateKey('testnet');
          var changeAddress = change.toAddress();
          var from = {
            txId: utxo.txid,
            address: utxo.address,
            script: utxo.scriptPubKey,
            satoshis: utxo.amount * 1e8,
            outputIndex: utxo.vout
          };
          tx = new Transaction().from(from).to(pk1.toAddress(), 2500000000).change(changeAddress).sign(pk);

          rpc2.sendRawTransaction(tx.serialize(), function(err, res) {
            if (err) {
              return next(err);
            }
            txid = res.result;
            console.log(txid);
            next();
          });
        });
      },
      function(next) {
        rpc2.generate(1, function() {
          setTimeout(next, 2000);
        });
      },
      function(next) {
        var tx2 = new Transaction().from({
          txId: txid,
          satoshis: 2500000000,
          outputIndex: 0,
          script: tx.outputs[0].script.toHex(),
          address: pk1.toAddress()
        }).to(pk1.toAddress(), 2500000000 - 1000).sign(pk1);
        rpc2.sendRawTransaction(tx2.serialize(), function(err, res) {
          if (err) {
            return next(err);
          }
          txid = res.result;
          console.log(txid);
          next();

        });
      },
      function(next) {
        rpc2.generate(1, function() {
          setTimeout(next, 2000);
        });
      },
    ], function(err) {
        if (err) {
          return done(err);
        }

        var request = http.request('http://localhost:53001/api/addr/' + pk1.toAddress(), function(res) {

          var error;
          if (res.statusCode !== 200 && res.statusCode !== 201) {
            if (error) {
              return;
            }
            return done('Error from bitcore-node webserver: ' + res.statusCode);
          }

          var resError;
          var resData = '';

          res.on('error', function(e) {
            resError = e;
          });

          res.on('data', function(data) {
            resData += data;
          });

          res.on('end', function() {
            if (error) {
              return;
            }
            var data = JSON.parse(resData);
            console.log(data);
            expect(data.transactions.length).to.equal(2);
            done();
          });

        });
        request.write('');
        request.end();

    });

  });
});



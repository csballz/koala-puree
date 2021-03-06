var chai = require("chai"),
	expect = chai.expect,
	chaiHttp = require("chai-http"),
	TestApp = require('../index'),
	sioClient = require("socket.io-client");

chai.use(chaiHttp);

describe('Routes', function(){
	var puree = new TestApp(), sio, socket;
	before(function(done) {
		this.timeout(5000);
		// this.timeout(50000);
		puree.start().then(function(){
			sio = sioClient('http://localhost:5000', {transports:['websocket']});
			// anotherSIO = sioClient('ws://218.202.236.54:8080/push/T820119/T820119');
			// console.log("trying to connect to that");
			// anotherSIO.once('connect', function(sock){
				// console.log("sock connected to ");
			// })
			// anotherSIO.once('error', function(sock){
				// console.log("sock failed to ");
			// })
			sio.once('connect', function(sock){
				done();
			})
		}, function(err){
			done(err);
		});
	})
	after(function(done){
        this.timeout(5000);
        sio.disconnect();
		puree.close().then(function(){
			done();
		},function(err){
			done(err);
		});
	})
    it('should have a get(/test)', function(done){

        chai.request("http://localhost:5000")
            .get("/test")
            .end(function(err, res){
                if ( err ) { return done(err); }
                expect(res).to.have.status(200);
                done();
            });
    });
    it('should have a post(/test)', function(done){
        chai
            .request("http://localhost:5000")
            .post("/test")
            .field("prepend", "abc")
            .end(function(err, res){
                console.log(err, res);
                if ( err ) { return done(err); }
                expect(res).to.have.status(200);
                expect(res.text).to.eql('postabc')
                done();
            });
    });
    it('should have a get(/test/:name)', function(done){
        chai.request("http://localhost:5000")
            .get("/test/felix")
            .end(function(err, res){
                if ( err ) { return done(err); }
                expect(res).to.have.status(200);
                done();
            });
    });
    it('websocket: should have a get(/test)', function(done){
        sio.emit('s', "get", "/test", {},{}, function(status, headers, body){
            expect(status).eql(200);
            expect(body).eql('get')
            done();
        });
    });
    it('websocket: should have a post(/test)', function(done){
        sio.emit('s', "post", "/test", {"prepend":"abc"},{}, function(status, headers, body){
            expect(status).eql(200);
            expect(body).eql('postabc')
            done();
        });
    });
    it('websocket: should have a get(/test/:name)', function(done){
        sio.emit('s', "get", "/test/felix", {},{}, function(status, headers, body){
            expect(status).eql(200);
            expect(body).eql('felix')
            done();
        });
    });

    it('promises: should have a get(/promises/test)', function(done){
        chai.request("http://localhost:5000")
            .get("/promises/test")
            .end((err, res) => {
                if ( err ) { return done(err); }
                expect(res).to.have.status(200);
                expect(res.text).to.eql("get");
                done();
            })
    })

    it('promises/websocket: should have a get(/promises/test)', function(done){
        sio.emit('s', "get", "/promises/test", {},{}, function(status, headers, body){
            expect(status).eql(200);
            expect(body).eql('get')
            done();
        });
    });

});


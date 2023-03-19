const { clock } = require('../config/global.js');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const readlineSync = require('readline-sync');
const fs = require('fs');
const { Timer } = require('easytimer.js');
const timer = new Timer();
var botFactory = {};

botFactory.buildBot = function (config) {
	var bot = new SteamUser({
		promptSteamGuardCode: false,
		dataDirectory: './accounts_data',
		singleSentryfile: false,
	});

	bot.username = config.username;
	bot.password = config.password;
	bot.sharedSecret = config.sharedSecret;
	bot.games = config.gamesAndStatus;
	bot.customStatus = config.enableStatus;
	bot.autoMessage = config.replyMessage;
	bot.receiveMessages = config.receiveMessages;
	bot.saveMessages = config.saveMessages;
	bot.messageReceived = {};

	if (bot.saveMessages) {
		try {
			if (!fs.existsSync(`${__dirname}/../messages`)) {
				fs.mkdirSync(`${__dirname}/../messages`);
			}

			if (!fs.existsSync(`${__dirname}/../messages/${bot.username}`)) {
				fs.mkdirSync(`${__dirname}/../messages/${bot.username}`);
			}
		} catch (err) {
			console.log(
				`[${bot.username}] It seems that you don't have the necessary permissions to save the messages in a file`
			);
		}
	}

	bot.on('loggedOn', function () {
		console.log(
			`[${
				this.username
			}] Logged into Steam as ${bot.steamID.getSteamID64()}\n`
		);
		if (bot.customStatus) {
			bot.setPersona(SteamUser.EPersonaState.Online);
			bot.gamesPlayed(this.games);
			return;
		}
		bot.setPersona(SteamUser.EPersonaState.Invisible);
		bot.gamesPlayed(this.games);
	});

	bot.on('error', function (err) {
		console.log(`[${this.username}] ${err}\n`);
		setTimeout(function () {
			bot.doLogin();
		}, 30 * 60 * 1000);
	});

	bot.doLogin = function () {
		this.logOn({
			accountName: this.username,
			password: this.password,
		});
	};

	bot.on('steamGuard', function (domain, callback) {
		if (!this.sharedSecret) {
			var authCode = readlineSync.question(
				`[${this.username}] Steam Guard ${
					!domain ? `Code (Mobile App): ` : `Code (${domain}): `
				}`
			);
			callback(authCode);
			return;
		}
		var authCode = SteamTotp.generateAuthCode(this.sharedSecret);
		console.log(`[${this.username}] Generated Auth Code: ${authCode}\n`);
		callback(authCode);
	});

	bot.on('friendMessage', function (steamID, message) {
		if (bot.receiveMessages) {
			console.log(
				`[${this.username}] Message from ${steamID}: ${message}\n`
			);
		}
		if (bot.saveMessages) {
			var messageFile = `${__dirname}/../messages/${this.username}/${steamID}.log`;
			fs.appendFile(messageFile, `${message}\n`, function (err) {
				if (err) {
					console.log(
						`[${bot.username}] There was an error saving the message of ${steamID}\n`
					);
					return;
				}
			});
		}
		if (!this.messageReceived[steamID]) {
			if (bot.autoMessage != '') {
				bot.chatMessage(steamID, bot.autoMessage);
			}
			this.messageReceived[steamID] = true;
		}
	});

	if (clock) {
		timer.start();
		timer.addEventListener('secondsUpdated', function (err) {
			process.stdout.write(
				`* Timer: ${timer.getTimeValues().toString()}`
			);
			process.stdout.cursorTo(0);
		});
	}

	return bot;
};

module.exports = botFactory;

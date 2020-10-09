const steamClientFactory = require('./accountHandler.js');
var configsArray = require('../config/accounts.js');
var botArray = [];

console.clear();
console.log(`\n* Detected ${configsArray.length} account(s) in the config.`);

for (i = 0; i < configsArray.length; i++) {
	var config = configsArray[i];
	var bot = steamClientFactory.buildBot(config);
	bot.doLogin();
	botArray.push(bot);
};

console.log(`* Starting idling ${botArray.length} account(s).\n* Press CTRL + C to exit.\n`);

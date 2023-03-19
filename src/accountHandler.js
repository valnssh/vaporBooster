const steamClientFactory = require('./hourBooster.js');
var configsArray = require('../config/accounts.js');
var botArray = [];

console.clear();
console.log(`\n* Detected ${configsArray.length} account(s) in the config.`);

for (i = 0; i < configsArray.length; i++) {
	var config = configsArray[i];

	if (config.gamesAndStatus.length > 32) {
		console.log(
			`* An error has occurred, account #${i} has more than 32 games in the list.`
		);
		console.log(
			`* (If you want to boost exactly 32 games, you might consider replacing the String of the custom status with the Integer (ID) of one game.)\n`
		);
		process.exit(1);
	}

	var bot = steamClientFactory.buildBot(config);
	bot.doLogin();
	botArray.push(bot);
}

console.log(
	`* Starting idling ${botArray.length} account(s).\n* Press CTRL + C to exit.\n`
);

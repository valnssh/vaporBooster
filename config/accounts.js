var configsArray = [];
var config;

// 1st Account (you can boost many accounts as you want)
config = {};
config.username = 'username'; // Account username
config.password = 'password'; // Account password
config.sharedSecret = ''; // Shared secret (2FA only), leave it blank for steam guard code
config.enableStatus = true; // Set it to false if you want to stay invisible
config.gamesAndStatus = [
	'Boosting hours...', // Your custom status (counts as a game, you can only boost 31 games with the custom status)
	730,
	440,
	570,
]; // IDs of the games, separated by comma
config.replyMessage = ''; // Leave it blank for no reply message
config.receiveMessages = false; // Do you want to log the messages that you receive in the terminal?
config.saveMessages = false; // Do you want to save the messages that you receive in a file?
configsArray.push(config);

// 2nd account (you can boost many accounts as you want)
config = {};
config.username = 'username'; // Account username
config.password = 'password'; // Account password
config.sharedSecret = ''; // Shared secret (2FA only), leave it blank for steam guard code
config.enableStatus = true; // Set it to false if you want to stay invisible
config.gamesAndStatus = [1172470, 730, 440, 570]; // IDs of the games, separated by comma (without the status, this is necessary in case you want to boost 32 games)
config.replyMessage = ''; // Leave it blank for no reply message
config.receiveMessages = false; // Do you want to log the messages that you receive in the terminal?
config.saveMessages = false; // Do you want to save the messages that you receive in a file?
configsArray.push(config);

module.exports = configsArray;

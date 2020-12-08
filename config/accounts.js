var configsArray = [];
var config;

// 1st Account (You can boost many accounts as you want)
config = {};
config.username = 'username'; // Account username
config.password = 'password'; // Account password
config.sharedSecret = ''; // Shared secret (2FA only), leave it blank for steam guard code
config.enableStatus = true; // Set it to false if you want to stay invisible
config.gamesAndStatus = [
	"Boosting Hours @ valencitoh.com", // Your custom status
	730, 440, 570]; // IDs of the games, separated by comma
config.replyMessage = ''; // Leave it blank for no reply message
config.receiveMessages = false; // Do you want to log the messages that you receive in the terminal?
config.saveMessages = false; // Do you want to save the messages that you receive in a file? 
configsArray.push(config);

// 2nd account (You can boost many accounts as you want)
config = {};
config.username = 'username'; // Account username
config.password = 'password'; // Account password
config.sharedSecret = ''; // Shared secret (2FA only), leave it blank for steam guard code
config.enableStatus = true; // Set it to false if you want to stay invisible
config.gamesAndStatus = [
	"Boosting Hours @ valencitoh.com", // Your custom status
	730, 440, 570]; // IDs of the games, separated by comma
config.replyMessage = ''; // Leave it blank for no reply message
config.receiveMessages = false; // Do you want to log the messages that you receive in the terminal?
config.saveMessages = false; // Do you want to save the messages that you receive in a file? 
configsArray.push(config);

module.exports = configsArray;

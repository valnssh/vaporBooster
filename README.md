-   #### This is a fork of [_the hour booster made by klorik._](https://www.unknowncheats.me/forum/cs-go-releases/201270-ez-steam-hours-booster-nodejs-steamguard-2fa.html)

# vaporBooster, a simple Steam hour booster with 2FA support

Boost multiple account with this [**NodeJS**](https://nodejs.org/en/download/) script with 2FA support!  
_(And it is not necessary to use the shared secret key)_

## Installation

```bash
# Install dependencies ⌨️
$ npm install
```

## Startup

```bash
# Start the booster 🎉
$ npm run start
```

## Example of the config (config/accounts.js)

```javascript
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
```

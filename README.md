* #### This is a fork of [*the hour booster made by klorik.*](https://www.unknowncheats.me/forum/cs-go-releases/201270-ez-steam-hours-booster-nodejs-steamguard-2fa.html)

# Steam Hour Booster (2FA Support)

Boost multiple account with this [**NodeJS**](https://nodejs.org/en/download/) script with 2FA support!  
*(And it is not necessary to use the shared secret key)*

## Installation & Startup [Automatic mode for Windows]

* [**Tutorial Video**](https://youtu.be/JNBsTL1XZUE)  
	* You need to run «Installer.bat».  
	* And for the startup just run «HourBooster.bat».

## Installation [Manual]
```bash
# Delete package-lock.json
$ rm package-lock.json

# Install dependencies
$ npm install
```
This command should install **steam**, **steam-user**, **steam-totp**, **readline-sync** and **easytimer.js** libraries.
* *We are deleting `package-lock.json` before running `npm install` to fix npm errors failing to install git dependencies.*
	* *You can also use `npm ci` and it will work too.*

## Startup [Manual]
```bash
# Start the booster 🎉
$ npm run start
```

## Example of the config (accounts.js)
```javascript
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
```

### License
[GNU GPLv3](https://choosealicense.com/licenses/gpl-3.0/)

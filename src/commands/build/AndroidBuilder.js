/**
 * @flow
 */

import fs from 'fs-extra';
import path from 'path';
import untildify from 'untildify';
import { Exp, Credentials } from 'xdl';
import chalk from 'chalk';
import log from '../../log';

import BaseBuilder from './BaseBuilder';
import prompt from '../../prompt';

export default class AndroidBuilder extends BaseBuilder {
  async run() {
    // Check the status of any current builds
    await this.checkStatus();
    // Validate project
    await this.validateProject();
    // Check for existing credentials, collect any missing credentials, and validate them
    await this.collectAndValidateCredentials();
    // Publish the current experience, if necessary
    const publishedExpIds = await this.ensureReleaseExists('android');
    // Initiate a build
    await this.build(publishedExpIds, 'android');
  }

  async _clearCredentials() {
    const {
      args: { username, remotePackageName, remoteFullPackageName: experienceName },
    } = await Exp.getPublishInfoAsync(this.projectDir);

    const credentialMetadata = {
      username,
      experienceName,
      platform: 'android',
    };

    log.warn(
      `Clearing your Android build credentials from our build servers is a ${chalk.red(
        'PERMANENT and IRREVERSIBLE action.'
      )}`
    );
    log.warn(
      'Android keystores must be identical to the one previously used to submit your app to the Google Play Store.'
    );
    log.warn(
      'Please read https://docs.expo.io/versions/latest/guides/building-standalone-apps.html#if-you-choose-to-build-for-android for more info before proceeding.'
    );
    log.warn(
      "We'll store a backup of your Android keystore in this directory in case you decide to delete it from our servers."
    );
    let questions = [
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Permanently delete the Android build credentials from our servers?',
      },
    ];

    const answers = await prompt(questions);

    if (answers.confirm) {
      log('Backing up your Android keystore now...');
      const backupKeystoreOutputPath = path.resolve(
        this.projectDir,
        `${remotePackageName}.jks.bak`
      );
      await Credentials.backupExistingAndroidCredentials({
        outputPath: backupKeystoreOutputPath,
        username,
        experienceName,
        log,
      });
      await Credentials.removeCredentialsForPlatform('android', credentialMetadata);
      log.warn('Removed existing credentials from Expo servers');
    }
  }

  async collectAndValidateCredentials() {
    const {
      args: { username, remoteFullPackageName: experienceName },
    } = await Exp.getPublishInfoAsync(this.projectDir);

    const credentialMetadata = {
      username,
      experienceName,
      platform: 'android',
    };

    const credentialsExist = await Credentials.credentialsExistForPlatformAsync(credentialMetadata);

    if (this.checkEnv()) {
      await this.collectAndValidateCredentialsFromCI(credentialMetadata);
    } else if (this.options.clearCredentials || !credentialsExist) {
      console.log('');
      const questions = [
        {
          type: 'rawlist',
          name: 'uploadKeystore',
          message: `Would you like to upload a keystore or have us generate one for you?\nIf you don't know what this means, let us handle it! :)\n`,
          choices: [
            { name: 'Let Expo handle the process!', value: false },
            { name: 'I want to upload my own keystore!', value: true },
          ],
        },
        {
          type: 'input',
          name: 'keystorePath',
          message: `Path to keystore:`,
          validate: async keystorePath => {
            try {
              const keystorePathStats = await fs.stat(keystorePath);
              return keystorePathStats.isFile();
            } catch (e) {
              // file does not exist
              console.log('\nFile does not exist.');
              return false;
            }
          },
          filter: keystorePath => {
            keystorePath = untildify(keystorePath);
            if (!path.isAbsolute(keystorePath)) {
              keystorePath = path.resolve(keystorePath);
            }
            return keystorePath;
          },
          when: answers => answers.uploadKeystore,
        },
        {
          type: 'input',
          name: 'keystoreAlias',
          message: `Keystore Alias:`,
          validate: val => val !== '',
          when: answers => answers.uploadKeystore,
        },
        {
          type: 'password',
          name: 'keystorePassword',
          message: `Keystore Password:`,
          validate: val => val !== '',
          when: answers => answers.uploadKeystore,
        },
        {
          type: 'password',
          name: 'keyPassword',
          message: `Key Password:`,
          validate: (password, answers) => {
            if (password === '') {
              return false;
            }
            // Todo validate keystore passwords
            return true;
          },
          when: answers => answers.uploadKeystore,
        },
      ];

      // const answers = await prompt(questions);
      const answers = {
        uploadKeystore: false
      };

      if (!answers.uploadKeystore) {
        if (this.options.clearCredentials && credentialsExist) {
          await this._clearCredentials();
        }
        // just continue
      } else {
        const { keystorePath, keystoreAlias, keystorePassword, keyPassword } = answers;

        // read the keystore
        const keystoreData = await fs.readFile(keystorePath);

        const credentials = {
          keystore: keystoreData.toString('base64'),
          keystoreAlias,
          keystorePassword,
          keyPassword,
        };
        await Credentials.updateCredentialsForPlatform('android', credentials, credentialMetadata);
      }
    }
  }

  checkEnv() {
    return (
      this.options.keystorePath &&
      this.options.keystoreAlias &&
      process.env.EXPO_ANDROID_KEYSTORE_PASSWORD &&
      process.env.EXPO_ANDROID_KEY_PASSWORD
    );
  }

  async collectAndValidateCredentialsFromCI(credentialMetadata) {
    const credentials = {
      keystore: (await fs.readFile(this.options.keystorePath)).toString('base64'),
      keystoreAlias: this.options.keystoreAlias,
      keystorePassword: process.env.EXPO_ANDROID_KEYSTORE_PASSWORD,
      keyPassword: process.env.EXPO_ANDROID_KEY_PASSWORD,
    };
    await Credentials.updateCredentialsForPlatform('android', credentials, credentialMetadata);
  }

  async validateProject() {
    const { args: { sdkVersion } } = await Exp.getPublishInfoAsync(this.projectDir);
    await this.checkIfSdkIsSupported(sdkVersion, 'android');
  }
}

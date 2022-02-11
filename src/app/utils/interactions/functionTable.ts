import { updatePOAPDAddress } from './../mongoDbOperations/updatePOAPDeliveryAddress';
import { deletUserAddressInteraction } from './MenuInteractions/deleteUserAddressInteraction';
import { deleteUserAddress } from './../mongoDbOperations/deleteUserAddress';
import { v1WalletConnect } from '../v1WalletConnect';
import { sendLinkToWebsite } from '../sendLinkToWebsite';
import { changePOAPAddressInteraction } from './MenuInteractions/changePOAPAddressInteraction';
import Log, { LogUtils } from '../Log';
import { DMChannel, User } from 'discord.js';
import { DiscordUserCollection } from '../../types/discord/DiscordUserCollection';
import { error } from 'console';

export const functionTable = async (functionToCall: string, args:{user: User, dmChannel: DMChannel, discordUserDocument: DiscordUserCollection}, selectedItemDescription?:string): Promise<any> => {
	Log.debug(`FunctionTable ${functionToCall}`);
	const { user, dmChannel, discordUserDocument } = args;

	selectedItemDescription === undefined ? 'empty' : selectedItemDescription;

	
	switch (functionToCall) {
	case 'walletConnect':
		return await v1WalletConnect(user, dmChannel, discordUserDocument, 'qrCode');
	case 'walletConnectDeepLink':
		return await v1WalletConnect(user, dmChannel, discordUserDocument, 'deepLink');
	case 'changePOAPAddress':
		await changePOAPAddressInteraction(user, dmChannel, discordUserDocument);
		break;
	case 'deleteAddressInteraction':
		await deletUserAddressInteraction(user, dmChannel, discordUserDocument);
		break;
	case 'updatePOAPAddress':
		if (selectedItemDescription) {
			return await updatePOAPDAddress(user, selectedItemDescription);
		} break;
	case 'deleteUserAddress':
		if (selectedItemDescription) {
			return await deleteUserAddress(user, selectedItemDescription);
		} break;
	case 'sendLinkToWebsite':
		return await sendLinkToWebsite();
	default:
		LogUtils.logError('Function table did not find a case.', error);
		await dmChannel.send('Something appears to have gone wrong.');
	}
};
import {
	GuildMember,
	Message,
	MessageActionRow,
	MessageButton,
	MessageEmbedOptions,
	MessageOptions,
	Role,
	TextChannel,
} from 'discord.js';
import ValidationError from '../../../errors/ValidationError';
import {
	BulkWriteError,
	Collection as MongoCollection,
	CollectionInsertManyOptions,
	Db,
	InsertWriteOpResult,
	MongoError,
} from 'mongodb';
import constants from '../../constants/constants';
import { POAPAdmin } from '../../../types/poap/POAPAdmin';
import ServiceUtils from '../../../utils/ServiceUtils';
import {
	ButtonStyle,
	CommandContext,
	ComponentType,
	Message as MessageSlash,
	MessageEmbedOptions as MessageEmbedOptionsSlash,
} from 'slash-create';
import Log, { LogUtils } from '../../../utils/Log';
import MongoDbUtils from '../../../utils/MongoDbUtils';
import { MessageOptions as MessageOptionsSlash } from 'slash-create';
import dayjs from 'dayjs';
import buttonIds from '../../constants/buttonIds';

export default async (ctx: CommandContext, guildMember: GuildMember, roles: string[], users: string[]): Promise<any> => {
	if (ctx.guildID == undefined) {
		await ctx.send({ content: 'Please try configuration within discord channel', ephemeral: true });
		return;
	}
	
	if (!(ServiceUtils.isDiscordAdmin(guildMember) || ServiceUtils.isDiscordServerManager(guildMember))) {
		throw new ValidationError('Sorry, only discord admins and managers can configure poap settings.');
	}
	
	await ctx.send({ content: 'testing', ephemeral: true });
	// const channel: TextChannel | ThreadChannel = await guildMember.guild.channels.fetch(ctx.channelID) as TextChannel;
	
	const isDmOn = false;
	
	if (isDmOn) {
		await ctx.send({ content: 'I just sent you a DM!', ephemeral: true });
	} else {
		await ctx.send({ content: '⚠ **Please make sure this is a private channel.** I can help you configure authorized users for the POAP commands!', ephemeral: true });
	}
	
	const authorizedRoles: Role[] = await retrieveRoles(guildMember, roles);
	const authorizedUsers: GuildMember[] = await retrieveUsers(guildMember, users);

	if (authorizedRoles.length == 0 && authorizedUsers.length == 0) {
		throw new ValidationError('Please try again with at least 1 discord user or role.');
	}
	const intro: MessageEmbedOptions | MessageEmbedOptionsSlash = {
		title: 'POAP Configuration',
		description: 'Welcome to POAP configuration.\n\n' +
			'This is used as a first-time setup of POAP commands. I can help assign or remove authorized users and ' +
			'roles for POAP distribution.\n\n' +
			'Authorized users will have access to a list of participants after the event has ended. They will also be ' +
			'able to send out mass messages to those participants.',
		footer: {
			text: '@Bankless DAO 🏴',
		},
	};
	Log.debug(`${guildMember.user.tag} is authorized to use poap modify`);
	
	const isApproval: boolean = await askForGrantOrRemoval(ctx, guildMember, authorizedRoles, authorizedUsers, isDmOn, intro);
	const dbInstance: Db = await MongoDbUtils.connect(constants.DB_NAME_DEGEN);
	let confirmationMsg;
	if (isApproval) {
		await storePOAPAdmins(guildMember, dbInstance, authorizedUsers, authorizedRoles);
		confirmationMsg = {
			title: 'Configuration Added',
			description: 'The list of users and roles are now authorized to use poap commands.',
		};
	} else {
		await removePOAPAdmins(guildMember, dbInstance, authorizedUsers, authorizedRoles);
		confirmationMsg = {
			title: 'Configuration Removed',
			description: 'The list of users and roles have now been restricted and will not be able to use poap commands.',
		};
	}
	
	const endConfigMsg: MessageOptions | MessageOptionsSlash = {
		embeds: [confirmationMsg],
		ephemeral: true,
	};
	await ServiceUtils.sendContextMessage(endConfigMsg, isDmOn, guildMember, ctx);
	return;
};

export const askForGrantOrRemoval = async (
	ctx: CommandContext, guildMember: GuildMember, authorizedRoles: Role[], authorizedUsers: GuildMember[],
	isDmOn: boolean, intro?: MessageEmbedOptions | MessageEmbedOptionsSlash,
): Promise<boolean> => {
	const fields = [];
	for (const role of authorizedRoles) {
		fields.push({
			name: 'Role',
			value: role.name,
			inline: true,
		});
	}
	for (const member of authorizedUsers) {
		fields.push({
			name: 'UserTag',
			value: member.user.tag,
			inline: true,
		}, {
			name: 'UserId',
			value: member.user.id.toString(),
			inline: true,
		});
	}
	let whichRolesAreAllowedQuestion: MessageEmbedOptions | MessageEmbedOptionsSlash = {
		title: 'Give or remove access?',
		description: 'Should the given list of users and roles be given access or should they get removed?',
		fields: fields,
	};
	
	let msg1: MessageOptions | MessageOptionsSlash;
	if (isDmOn) {
		whichRolesAreAllowedQuestion = whichRolesAreAllowedQuestion as MessageEmbedOptions;
		whichRolesAreAllowedQuestion.timestamp = new Date().getTime();
		msg1 = {
			embeds: [intro, whichRolesAreAllowedQuestion],
			components: [
				new MessageActionRow().addComponents(
					new MessageButton()
						.setCustomId(buttonIds.POAP_CONFIG_APPROVE)
						.setLabel('Approve')
						.setStyle('SUCCESS'),
					new MessageButton()
						.setCustomId(buttonIds.POAP_CONFIG_REMOVE)
						.setLabel('Remove')
						.setStyle('DANGER'),
				),
			],
		} as MessageOptions;
	} else {
		whichRolesAreAllowedQuestion = whichRolesAreAllowedQuestion as MessageEmbedOptionsSlash;
		whichRolesAreAllowedQuestion.timestamp = dayjs().toDate();
		msg1 = {
			embeds: [intro, whichRolesAreAllowedQuestion],
			components: [{
				type: ComponentType.ACTION_ROW,
				components: [{
					type: ComponentType.BUTTON,
					style: ButtonStyle.SUCCESS,
					label: 'Approve',
					custom_id: buttonIds.POAP_CONFIG_APPROVE,
				}, {
					type: ComponentType.BUTTON,
					style: ButtonStyle.DESTRUCTIVE,
					label: 'Reject',
					custom_id: buttonIds.POAP_CONFIG_REMOVE,
				}],
			}],
			ephemeral: true,
		} as MessageOptionsSlash;
	}
	
	let message = await ServiceUtils.sendContextMessage(msg1, isDmOn, guildMember, ctx);
	
	if (isDmOn) {
		message = message as Message;
	} else {
		message = message as MessageSlash;
		const textChannel: TextChannel = await guildMember.guild.channels.fetch(ctx.channelID) as TextChannel;
		message = await textChannel.messages.fetch(message.id) as Message;
	}
	let configConsent = false;
	await message.awaitMessageComponent({
		time: 600_000,
		filter: args => (args.customId == buttonIds.POAP_CONFIG_APPROVE
			|| args.customId == buttonIds.POAP_CONFIG_REMOVE) && args.user.id == guildMember.id.toString(),
	}).then((interaction) => {
		if (interaction.customId == buttonIds.POAP_CONFIG_APPROVE) {
			Log.info('/poap config add');
			configConsent = true;
		} else if (interaction.customId == buttonIds.POAP_CONFIG_REMOVE) {
			Log.info('/poap config remove');
			configConsent = false;
		}
	}).catch(error => {
		Log.debug(error?.message);
		throw new ValidationError('Timeout reached, please try command again to start a new session.');
	});
	return configConsent;
};

export const retrieveRoles = async (guildMember: GuildMember, authorizedRoles: string[]): Promise<Role[]> => {
	const roles: Role[] = [];
	for (const authRole of authorizedRoles) {
		if (authRole == null) continue;
		try {
			const roleManager: Role | null = await guildMember.guild.roles.fetch(authRole);
			if (!roleManager) {
				throw new Error('failed to find role manager');
			}
			roles.push(roleManager);
		} catch (e) {
			LogUtils.logError('failed to retrieve role from user', e);
		}
	}
	return roles;
};

export const retrieveUsers = async (guildMember: GuildMember, authorizedUsers: string[]): Promise<GuildMember[]> => {
	const users: GuildMember[] = [];
	for (const authUser of authorizedUsers) {
		if (authUser == null) continue;
		try {
			const member: GuildMember = await guildMember.guild.members.fetch(authUser);
			users.push(member);
		} catch (e) {
			LogUtils.logError('failed to retrieve role from user', e);
		}
	}
	return users;
};

export const storePOAPAdmins = async (
	guildMember: GuildMember, dbInstance: Db, authorizedUsers: GuildMember[], authorizedRoles: Role[],
): Promise<any> => {
	const poapAdminDb: MongoCollection<POAPAdmin> = dbInstance.collection(constants.DB_COLLECTION_POAP_ADMINS);
	
	const poapAdminsList = [];
	for (const member of authorizedUsers) {
		poapAdminsList.push({
			objectType: 'USER',
			discordObjectId: member.id,
			discordObjectName: member.user.tag,
			discordServerId: guildMember.guild.id,
			discordServerName: guildMember.guild.name,
		} as POAPAdmin);
	}
	for (const role of authorizedRoles) {
		poapAdminsList.push({
			objectType: 'ROLE',
			discordObjectId: role.id,
			discordObjectName: role.name,
			discordServerId: guildMember.guild.id,
			discordServerName: guildMember.guild.name,
		} as POAPAdmin);
	}
	
	let result: InsertWriteOpResult<POAPAdmin>;
	try {
		result = await poapAdminDb.insertMany(poapAdminsList, {
			ordered: false,
		} as CollectionInsertManyOptions);
		
		if (result == null) {
			throw new MongoError('failed to insert poapAdmins');
		}
	} catch (e) {
		if (e instanceof BulkWriteError && e.code === 11000) {
			LogUtils.logError('dup key found, proceeding', e);
		} else {
			LogUtils.logError('failed to store poap admins from db', e);
			return;
		}
	}
};

export const removePOAPAdmins = async (
	guildMember: GuildMember, db: Db, authorizedUsers: GuildMember[], authorizedRoles: Role[],
): Promise<any> => {
	const poapAdminDb: MongoCollection = db.collection(constants.DB_COLLECTION_POAP_ADMINS);
	try {
		for (const member of authorizedUsers) {
			await poapAdminDb.deleteOne({
				objectType: 'USER',
				discordObjectId: member.id,
				discordServerId: guildMember.guild.id,
			});
		}
		for (const role of authorizedRoles) {
			await poapAdminDb.deleteOne({
				objectType: 'ROLE',
				discordObjectId: role.id,
				discordServerId: guildMember.guild.id,
			});
		}
	} catch (e) {
		LogUtils.logError('failed to remove poap admins from db', e);
	}
};


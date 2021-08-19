import { GuildMember, Message, MessageEmbed } from 'discord.js';
import BountyUtils from '../../utils/BountyUtils';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import dbInstance from '../../utils/db';
import constants from '../constants/constants';
import envUrls from '../constants/envUrls';
import { BountyCollection } from '../../types/bounty/BountyCollection';

export default async (guildMember: GuildMember, bountyId: string, urlOfWork?: string, notes?: string): Promise<any> => {
	await BountyUtils.validateBountyId(guildMember, bountyId);
	
	if (urlOfWork) {
		await BountyUtils.validateUrl(guildMember, urlOfWork);
	}
	
	if (notes) {
		await BountyUtils.validateSummary(guildMember, notes);
	}
	return submitBountyForValidId(guildMember, bountyId, urlOfWork, notes);
};

export const submitBountyForValidId = async (guildMember: GuildMember,
	bountyId: string, urlOfWork?: string, notes?: string, message?: Message,
): Promise<any> => {
	const db: Db = await dbInstance.dbConnect(constants.DB_NAME_BOUNTY_BOARD);
	const dbCollection = db.collection(constants.DB_COLLECTION_BOUNTIES);

	const dbBountyResult: BountyCollection = await dbCollection.findOne({
		_id: new mongo.ObjectId(bountyId),
		status: 'In-Progress',
	});

	await BountyUtils.checkBountyExists(guildMember, dbBountyResult, bountyId);
	
	if (dbBountyResult.claimedBy.discordId !== guildMember.user.id) {
		console.log(`${bountyId} bounty not claimed by ${guildMember.user.tag} but it is claimed by ${dbBountyResult.claimedBy.discordHandle}`);
		return guildMember.send({ content: `Sorry <@${guildMember.user.id}>, bounty \`${bountyId}\` is claimed by someone else.` });
	}

	if (dbBountyResult.status !== 'In-Progress') {
		console.log(`${bountyId} bounty not in progress`);
		return guildMember.send({ content: `Sorry <@${guildMember.user.id}>, bounty \`${bountyId}\` is not in progress.` });
	}

	const currentDate = (new Date()).toISOString();
	const writeResult: UpdateWriteOpResult = await dbCollection.updateOne(dbBountyResult, {
		$set: {
			submittedBy: {
				discordHandle: guildMember.user.tag,
				discordId: guildMember.user.id,
				iconUrl: guildMember.user.avatarURL(),
			},
			submittedAt: currentDate,
			status: 'In-Review',
			submissionUrl: urlOfWork,
			submissionNotes: notes,
		},
		$push: {
			statusHistory: {
				status: 'In-Review',
				setAt: currentDate,
			},
		},
	});

	if (writeResult.modifiedCount != 1) {
		console.log(`failed to update record ${bountyId} with submitted user  <@${guildMember.user.tag}>`);
		return guildMember.send({ content: 'Sorry something is not working, our devs are looking into it.' });
	}

	console.log(`${bountyId} bounty submitted by ${guildMember.user.tag}`);
	await submitBountyMessage(guildMember, dbBountyResult.discordMessageId, message);
	
	const bountyUrl = envUrls.BOUNTY_BOARD_URL + dbBountyResult._id;
	const createdByUser: GuildMember = guildMember.guild.members.cache.get(dbBountyResult.createdBy.discordId);
	await createdByUser.send({ content: `Please reach out to <@${guildMember.user.id}>. They are ready for bounty review ${bountyUrl}` });

	await guildMember.send({ content: `Bounty in review! Expect a message from <@${dbBountyResult.createdBy.discordId}>` });
	return dbInstance.close();
};

export const submitBountyMessage = async (guildMember: GuildMember, bountyMessageId: string, message?: Message): Promise<any> => {
	message = await BountyUtils.getBountyMessage(guildMember, bountyMessageId, message);

	const embedMessage: MessageEmbed = message.embeds[0];
	embedMessage.fields[3].value = 'In-Review';
	embedMessage.setColor('#d39e00');
	embedMessage.addField('Submitted By', guildMember.user.tag, true);
	embedMessage.setFooter('✅ - complete | 🔄 - refresh | 🆘 - help');
	await message.edit({ embeds: [embedMessage] });
	addSubmitReactions(message);
};

export const addSubmitReactions = (message: Message): void => {
	message.reactions.removeAll();
	message.react('✅');
	message.react('🔄');
	message.react('🆘');
};
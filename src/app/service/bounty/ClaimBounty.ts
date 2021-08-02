import constants from '../../constants';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import BountyUtils from '../../utils/BountyUtils';
import dbInstance from '../../utils/db';
import { GuildMember, Message, MessageEmbed } from 'discord.js';

const BOUNTY_BOARD_URL = 'https://bankless.community';

export default async (guildMember: GuildMember, bountyId: string): Promise<any> => {
	await BountyUtils.validateBountyId(guildMember, bountyId);
	return claimBountyForValidId(guildMember, bountyId);
};

export const claimBountyForValidId = async (guildMember: GuildMember,
	bountyId: string, message?: Message,
): Promise<any> => {
	const db: Db = await dbInstance.dbConnect(constants.DB_NAME_BOUNTY_BOARD);
	const dbCollection = db.collection(constants.DB_COLLECTION_BOUNTIES);
	
	const dbBountyResult = await dbCollection.findOne({
		_id: new mongo.ObjectId(bountyId),
		status: 'Open',
	});
	
	await BountyUtils.checkBountyExists(guildMember, dbBountyResult.discordMessageId, bountyId);

	if (dbBountyResult.claimedBy && dbBountyResult.status != 'Open') {
		console.log(`${bountyId} bounty already claimed by ${dbBountyResult.claimedBy.discordHandle}`);
		return guildMember.send(`Sorry <@${guildMember.user.id}>, bounty \`${bountyId}\` already claimed.`);
	}

	if (dbBountyResult.status != 'Open') {
		console.log(`${bountyId} bounty is not open`);
		return guildMember.send(`Sorry bounty \`${bountyId}\` is not Open.`);
	}

	const currentDate = (new Date()).toISOString();
	const writeResult: UpdateWriteOpResult = await dbCollection.updateOne(dbBountyResult, {
		$set: {
			claimedBy: {
				'discordHandle': guildMember.user.tag,
				'discordId': guildMember.user.id,
			},
			claimedAt: Date.now(),
			status: 'In-Progress',
		},
		$push: {
			statusHistory: {
				status: 'In-Progress',
				setAt: currentDate,
			},
		},
	});

	if (writeResult.modifiedCount != 1) {
		console.log(`failed to update record ${bountyId} with claimed user  <@${guildMember.user.tag}>`);
		return guildMember.send('Sorry something is not working, our devs are looking into it.');
	}
	await dbInstance.close();
	console.log(`${bountyId} bounty claimed by ${guildMember.user.tag}`);
	await claimBountyMessage(guildMember, dbBountyResult.discordMessageId, message);
	
	return guildMember.send(`<@${guildMember.user.id}> Bounty claimed! Feel free to reach out at any time ${BOUNTY_BOARD_URL}/${bountyId}`);
};

export const claimBountyMessage = async (guildMember: GuildMember, bountyMessageId: string, message?: Message): Promise<any> => {
	message = (message === null) ? await BountyUtils.getBountyMessage(guildMember, bountyMessageId) : message;
	
	const embedMessage: MessageEmbed = message.embeds[0];
	embedMessage.fields[1].value = 'In-Progress';
	embedMessage.addField('Claimed By', guildMember.user.tag);
	embedMessage.setFooter('✅ - complete | 🆘 - help');
	await message.edit(embedMessage);

	await message.reactions.removeAll();
	await message.react('✅');
	await message.react('🆘');
};
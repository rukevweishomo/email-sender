/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { Client } from '@notionhq/client';

interface Env {
	NOTION_API_KEY: string;
	MEMBER_KEY: string;
	SEND_EMAILS: SendEmail; // your binding type
}

interface Member {
	email: string;
	ratio: number;
}

async function getMembers(env: Env): Promise<Member[]> {
	const notion = new Client({ auth: env.NOTION_API_KEY });
	const members: Member[] = [];
	let cursor: string | undefined = undefined;

	do {
		const response = await notion.dataSources.query({
			data_source_id: env.MEMBER_KEY,
			filter: {
				and: [
					{ property: '2 Month Attendance Ratio', formula: { number: { greater_than: -0.0001 } } },
					{ property: '2 Month Attendance Ratio', formula: { number: { less_than: 50.0001 } } },
				],
			},
			start_cursor: cursor,
			page_size: 100,
		});

		for (const page of response.results) {
			// narrow to pages that actually have properties
			if (!('properties' in page)) continue;
			const props = page.properties as any;
			const email = props['Email']?.email;
			const ratio = props['2 Month Attendance Ratio']?.formula?.number;
			if (email) members.push({ email, ratio });
		}

		cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
	} while (cursor);

	return members;
}

async function sendEmails(members: Member[], env: Env) {
	const CHUNK = 20;
	for (let i = 0; i < members.length; i += CHUNK) {
		await Promise.all(
			members.slice(i, i + CHUNK).map((m) =>
				env.SEND_EMAILS.send({
					to: m.email,
					from: 'oishomo@ualberta.ca',
					subject: 'Just Checking In',
					text: "Hello! We're so glad you've been attending the fellowship. Although, we haven't seen you for a bit.\nWe'd love to see you more often! If there's anything wrong that we can help with, feel free to let us know.\nWe hope to see you soon!",
				}),
			),
		);
	}
	return { sent: members.length };
}

export default {
	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		console.log('Scheduled event fired at ' + new Date(controller.scheduledTime).toISOString());
		const members = await getMembers(env);
		const result = await sendEmails(members, env);
		console.log(`Sent ${result.sent} emails`);
	},

	async fetch(request, env, ctx): Promise<Response> {
		const members = await getMembers(env);
		const result = await sendEmails(members, env);
		return Response.json(result);
	},
} satisfies ExportedHandler<Env>;

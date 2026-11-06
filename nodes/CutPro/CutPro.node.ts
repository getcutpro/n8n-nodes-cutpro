import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

const BASE_URL = 'https://api.cut.pro/api/v1';
const MAX_SERVER_WAIT_SECONDS = 60;
const HTTP_TIMEOUT_MS = (MAX_SERVER_WAIT_SECONDS + 30) * 1000;
const GENERATION_KINDS = ['image', 'video', 'speech'];
const ASPECT_RATIOS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'];
const UNIT_NAMES: Record<string, string> = { image: 'image', second: 'second', '1k_characters': '1,000 characters' };

type Caller = IExecuteFunctions | ILoadOptionsFunctions;

async function cutProRequest(
	this: Caller,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: IDataObject; qs?: IDataObject; headers?: IDataObject } = {},
): Promise<IDataObject> {
	const response = await this.helpers.httpRequestWithAuthentication.call(this, 'cutProApi', {
		method,
		url: `${BASE_URL}${path}`,
		body: options.body,
		qs: options.qs,
		headers: options.headers,
		json: true,
		timeout: HTTP_TIMEOUT_MS,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	});
	const body = response.body ?? {};
	if (response.statusCode >= 400) {
		const code = typeof body.code === 'string' ? body.code : 'UNEXPECTED_RESPONSE';
		throw new NodeApiError(this.getNode(), body, {
			httpCode: String(response.statusCode),
			message: `Cut.Pro answered ${code}`,
			description: body.extra ? `Details: ${JSON.stringify(body.extra)}. Codes are explained at https://cut.pro/docs/en/errors` : 'Codes are explained at https://cut.pro/docs/en/errors',
		});
	}
	return body;
}

function lowestPrice(model: IDataObject): string {
	const pricing = Array.isArray(model.pricing) ? model.pricing : [];
	const lowest = pricing.reduce((best: IDataObject | undefined, row: IDataObject) => (!best || Number(row.credits) < Number(best.credits) ? row : best), undefined);
	if (!lowest) return '';
	return `From ${Math.ceil(Number(lowest.credits))} credits per ${UNIT_NAMES[String(lowest.unit)] ?? String(lowest.unit)}`;
}

function outputUrl(generation: IDataObject): string | null {
	const output = generation.output;
	return output && typeof output === 'object' && 'url' in output && typeof output.url === 'string' ? output.url : null;
}

function generationRequest(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const text = (name: string) => String(this.getNodeParameter(name, itemIndex, ''));
	const kind = text('kind');
	const request: IDataObject = { kind, model: text('model'), prompt: text('prompt') };
	if (kind === 'speech') request.voice = text('voice');
	if (kind === 'video') request.seconds = Number(this.getNodeParameter('seconds', itemIndex, 5));
	if (kind !== 'speech') {
		const urls = this.getNodeParameter('imageUrls', itemIndex, []);
		const imageUrls = Array.isArray(urls) ? urls.map(String).filter(Boolean) : [];
		if (imageUrls.length) request.image_urls = imageUrls;
		if (text('aspectRatio')) request.aspect_ratio = text('aspectRatio');
		if (text('resolution')) request.resolution = text('resolution');
	}
	if (text('additionalFields.mode')) request.mode = text('additionalFields.mode');
	if (kind === 'video' && text('additionalFields.audio') === 'false') request.audio = false;
	if (text('additionalFields.seed') !== '') request.seed = Number(this.getNodeParameter('additionalFields.seed', itemIndex));
	return request;
}

async function generate(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const request = generationRequest.call(this, itemIndex);
	const agreed = this.getNodeParameter('additionalFields.credits', itemIndex, '');
	const credits = agreed === '' ? (await cutProRequest.call(this, 'POST', '/generations/quote', { body: request })).credits : Number(agreed);
	const webhookUrl = String(this.getNodeParameter('additionalFields.webhookUrl', itemIndex, ''));
	const idempotencyKey = String(this.getNodeParameter('additionalFields.idempotencyKey', itemIndex, ''));
	const waitForCompletion = Boolean(this.getNodeParameter('waitForCompletion', itemIndex, true));

	let generation = await cutProRequest.call(this, 'POST', '/generations', {
		body: { ...request, credits, ...(webhookUrl ? { webhook_url: webhookUrl } : {}) },
		qs: waitForCompletion ? { wait: MAX_SERVER_WAIT_SECONDS } : {},
		headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
	});
	if (!waitForCompletion) return generation;

	const deadline = Date.now() + Number(this.getNodeParameter('timeoutMinutes', itemIndex, 10)) * 60_000;
	while (generation.status === 'processing') {
		const seconds = Math.min(MAX_SERVER_WAIT_SECONDS, Math.floor((deadline - Date.now()) / 1000));
		if (seconds <= 0) {
			throw new NodeOperationError(this.getNode(), `Generation ${String(generation.id)} is still processing`, {
				itemIndex,
				description: 'It keeps running and its credits stay charged. Read it later with the Get Generation operation, or raise Timeout (Minutes).',
			});
		}
		generation = await cutProRequest.call(this, 'GET', `/generations/${encodeURIComponent(String(generation.id))}`, { qs: { wait: seconds } });
	}
	if (generation.status === 'failed') {
		throw new NodeOperationError(this.getNode(), `Generation failed: ${String(generation.error_code)}`, {
			itemIndex,
			description: 'The credits were given back. SAFETY_BLOCKED, COPYRIGHT_BLOCKED and REAL_FACES_BLOCKED mean the model refused the content: change the prompt or the model. TIMEOUT and MEDIA_FAILED are worth another try.',
		});
	}
	return { ...generation, url: outputUrl(generation) };
}

const generationFields = { show: { resource: ['generation'], operation: ['generate', 'quote'] } };

export class CutPro implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Cut.Pro',
		name: 'cutPro',
		icon: { light: 'file:cutpro.svg', dark: 'file:cutpro.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Generate videos, images and voices with Seedance, Wan, Kling, Veo, Nano Banana, Seedream, GPT Image and Gemini TTS',
		defaults: { name: 'Cut.Pro' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'cutProApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Generation', value: 'generation' },
					{ name: 'Model', value: 'model' },
				],
				default: 'generation',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['generation'] } },
				options: [
					{ name: 'Generate', value: 'generate', action: 'Generate media', description: 'Get the price, generate and optionally wait for the file' },
					{ name: 'Get', value: 'get', action: 'Get a generation', description: 'Read the status and the file link of a generation' },
					{ name: 'Quote', value: 'quote', action: 'Get the price of a generation', description: 'Exact price in credits, without generating anything' },
				],
				default: 'generate',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['model'] } },
				options: [{ name: 'Get Many', value: 'getAll', action: 'Get many models', description: 'List the models with their options and prices' }],
				default: 'getAll',
			},
			{
				displayName: 'Kind',
				name: 'kind',
				type: 'options',
				displayOptions: generationFields,
				options: [
					{ name: 'Image', value: 'image' },
					{ name: 'Video', value: 'video' },
					{ name: 'Voice', value: 'speech' },
				],
				default: 'video',
			},
			{
				displayName: 'Model Name or ID',
				name: 'model',
				type: 'options',
				required: true,
				displayOptions: generationFields,
				typeOptions: { loadOptionsMethod: 'getModels', loadOptionsDependsOn: ['kind'] },
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				required: true,
				typeOptions: { rows: 4 },
				displayOptions: generationFields,
				default: '',
				description: 'What to make, in any language. For a voice, the text it reads word for word.',
			},
			{
				displayName: 'Voice Name or ID',
				name: 'voice',
				type: 'options',
				required: true,
				displayOptions: { show: { ...generationFields.show, kind: ['speech'] } },
				typeOptions: { loadOptionsMethod: 'getVoices', loadOptionsDependsOn: ['model'] },
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Seconds',
				name: 'seconds',
				type: 'number',
				displayOptions: { show: { ...generationFields.show, kind: ['video'] } },
				typeOptions: { minValue: 1, maxValue: 60 },
				default: 5,
				description: 'Length of the video. The nearest length the model makes is used.',
			},
			{
				displayName: 'Resolution',
				name: 'resolution',
				type: 'string',
				displayOptions: { show: { ...generationFields.show, kind: ['image', 'video'] } },
				default: '',
				placeholder: '720p',
				description: 'One of the model resolutions, such as 480p, 720p, 1080p or 2k. Empty uses the default.',
			},
			{
				displayName: 'Aspect Ratio',
				name: 'aspectRatio',
				type: 'options',
				displayOptions: { show: { ...generationFields.show, kind: ['image', 'video'] } },
				options: [{ name: 'Default (9:16 or the One in the Prompt)', value: '' }, ...ASPECT_RATIOS.map((ratio) => ({ name: ratio, value: ratio }))],
				default: '',
			},
			{
				displayName: 'Image URLs',
				name: 'imageUrls',
				type: 'string',
				typeOptions: { multipleValues: true },
				displayOptions: { show: { ...generationFields.show, kind: ['image', 'video'] } },
				default: [],
				placeholder: 'https://example.com/product.jpg',
				description: 'Public image links: one is the first frame of a video, two are the first and last frames, more are references',
			},
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				displayOptions: { show: { resource: ['generation'], operation: ['generate'] } },
				default: true,
				description: 'Whether to wait until the file is ready and return its link. Otherwise the node returns right away and the generation keeps running.',
			},
			{
				displayName: 'Timeout (Minutes)',
				name: 'timeoutMinutes',
				type: 'number',
				displayOptions: { show: { resource: ['generation'], operation: ['generate'], waitForCompletion: [true] } },
				typeOptions: { minValue: 1, maxValue: 60 },
				default: 10,
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: generationFields,
				default: {},
				options: [
					{
						displayName: 'Agreed Credits',
						name: 'credits',
						type: 'number',
						default: '',
						description: 'Total from a previous Quote. Empty quotes first and agrees to that total. If the price changed, nothing is charged and the node fails with PRICE_CHANGED.',
						displayOptions: { show: { '/operation': ['generate'] } },
					},
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						description: 'Any unique string. Repeating the same request with the same key within 24 hours never charges twice.',
						displayOptions: { show: { '/operation': ['generate'] } },
					},
					{
						displayName: 'Mode',
						name: 'mode',
						type: 'options',
						options: [
							{ name: 'Frames (First and Last Image)', value: 'frames' },
							{ name: 'Image (First Frame)', value: 'image' },
							{ name: 'References', value: 'references' },
							{ name: 'Text', value: 'text' },
						],
						default: 'text',
						description: 'Left out, it follows the images sent',
					},
					{
						displayName: 'Seed',
						name: 'seed',
						type: 'number',
						default: '',
						description: 'The same seed with the same request makes the closest result again',
					},
					{
						displayName: 'Sound',
						name: 'audio',
						type: 'options',
						options: [
							{ name: 'With Sound', value: 'true' },
							{ name: 'Without Sound', value: 'false' },
						],
						default: 'true',
						description: 'Whether the video has sound. Without sound usually costs less, on models that allow it.',
					},
					{
						displayName: 'Webhook URL',
						name: 'webhookUrl',
						type: 'string',
						default: '',
						description: 'Public https address that gets a signed POST when the generation ends',
						displayOptions: { show: { '/operation': ['generate'] } },
					},
				],
			},
			{
				displayName: 'Generation ID',
				name: 'generationId',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['generation'], operation: ['get'] } },
				default: '',
			},
			{
				displayName: 'Wait for Completion',
				name: 'waitForGeneration',
				type: 'boolean',
				displayOptions: { show: { resource: ['generation'], operation: ['get'] } },
				default: false,
				description: 'Whether to hold the answer up to 60 seconds while the generation is still processing',
			},
			{
				displayName: 'Kind',
				name: 'modelKind',
				type: 'options',
				displayOptions: { show: { resource: ['model'], operation: ['getAll'] } },
				options: [
					{ name: 'All', value: '' },
					{ name: 'Audio', value: 'audio' },
					{ name: 'Avatar', value: 'avatar' },
					{ name: 'Image', value: 'image' },
					{ name: 'Music', value: 'music' },
					{ name: 'Video', value: 'video' },
					{ name: 'Voice', value: 'speech' },
				],
				default: '',
			},
			{
				displayName: 'Featured Only',
				name: 'featuredOnly',
				type: 'boolean',
				displayOptions: { show: { resource: ['model'], operation: ['getAll'] } },
				default: false,
				description: 'Whether to list only the strongest models of each kind',
			},
		],
	};

	methods = {
		loadOptions: {
			async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const kind = String(this.getCurrentNodeParameter('kind') ?? 'video');
				const { models } = await cutProRequest.call(this, 'GET', '/models', { qs: { endpoint: 'generations', kind: GENERATION_KINDS.includes(kind) ? kind : 'video' } });
				const list: IDataObject[] = Array.isArray(models) ? models : [];
				return list.map((model) => ({ name: String(model.name), value: String(model.id), description: lowestPrice(model) }));
			},
			async getVoices(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const model = String(this.getCurrentNodeParameter('model') ?? '');
				if (!model) return [];
				const { models } = await cutProRequest.call(this, 'GET', '/models', { qs: { id: model } });
				const [found]: IDataObject[] = Array.isArray(models) ? models : [];
				const voices: IDataObject[] = Array.isArray(found?.voices) ? found.voices : [];
				return voices.map((voice) => ({
					name: String(voice.name),
					value: String(voice.id),
					description: [voice.gender, voice.style, voice.language].filter(Boolean).join(', '),
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const results: INodeExecutionData[] = [];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex);
				const operation = this.getNodeParameter('operation', itemIndex);
				if (resource === 'model') {
					const kind = String(this.getNodeParameter('modelKind', itemIndex, ''));
					const path = this.getNodeParameter('featuredOnly', itemIndex, false) ? '/models/featured' : '/models';
					const { models } = await cutProRequest.call(this, 'GET', path, { qs: { endpoint: 'generations', ...(kind ? { kind } : {}) } });
					const list: IDataObject[] = Array.isArray(models) ? models : [];
					for (const model of list) results.push({ json: model, pairedItem: { item: itemIndex } });
				} else if (operation === 'quote') {
					const quote = await cutProRequest.call(this, 'POST', '/generations/quote', { body: generationRequest.call(this, itemIndex) });
					results.push({ json: quote, pairedItem: { item: itemIndex } });
				} else if (operation === 'get') {
					const id = String(this.getNodeParameter('generationId', itemIndex));
					const wait = this.getNodeParameter('waitForGeneration', itemIndex, false);
					const generation = await cutProRequest.call(this, 'GET', `/generations/${encodeURIComponent(id)}`, { qs: wait ? { wait: MAX_SERVER_WAIT_SECONDS } : {} });
					results.push({ json: { ...generation, url: outputUrl(generation) }, pairedItem: { item: itemIndex } });
				} else {
					results.push({ json: await generate.call(this, itemIndex), pairedItem: { item: itemIndex } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					results.push({ json: { error: error.message }, pairedItem: { item: itemIndex } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error, { itemIndex });
			}
		}
		return [results];
	}
}

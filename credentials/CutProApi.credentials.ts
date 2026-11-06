import type { IAuthenticateGeneric, Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class CutProApi implements ICredentialType {
	name = 'cutProApi';

	displayName = 'Cut.Pro API';

	icon: Icon = { light: 'file:../nodes/CutPro/cutpro.svg', dark: 'file:../nodes/CutPro/cutpro.dark.svg' };

	documentationUrl = 'https://github.com/getcutpro/n8n-nodes-cutpro#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Create a key at https://cut.pro/studio/me/api-keys',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-Api-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.cut.pro/api/v1',
			url: '/workspace',
		},
	};
}

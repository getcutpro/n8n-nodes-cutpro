# n8n-nodes-cutpro: Seedance, Wan, Kling, Veo, Nano Banana and Gemini TTS in n8n

[![npm](https://img.shields.io/npm/v/n8n-nodes-cutpro)](https://www.npmjs.com/package/n8n-nodes-cutpro) [![license](https://img.shields.io/npm/l/n8n-nodes-cutpro)](LICENSE)

An [n8n](https://n8n.io) community node for [Cut.Pro](https://cut.pro): generate videos, images and voices in your workflows with Seedance 2.5, Wan 3, Kling O3, Veo 3.1, Gemini Omni Flash, Nano Banana Pro, Seedream 5, Qwen Image, GPT Image, Grok Imagine, MiniMax and Gemini TTS voices, all with one API key. Priced per second of video, per image or per 1,000 characters of voice, in reais and dollars: see the [live price list](https://cut.pro/en/models). Pay with Pix or card; companies get an invoice.

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Example workflows](#example-workflows)
- [Compatibility](#compatibility)

## Installation

In n8n, open **Settings > Community Nodes > Install** and enter `n8n-nodes-cutpro`. See the [n8n guide to community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

1. Create a key at [cut.pro/studio/me/api-keys](https://cut.pro/studio/me/api-keys). Every account starts with free credits.
2. In n8n, add a **Cut.Pro API** credential and paste the key. n8n checks it against `GET /workspace`, which charges nothing.

The key spends credits: share the credential only with people who may generate.

## Operations

### Generation: Generate

Gets the price, starts the generation with that price and, with **Wait for Completion** on (the default), waits until the file is ready.

| Field | What it does |
|---|---|
| Kind | Image, Video or Voice. Filters the model list. |
| Model | Loaded from the live catalog, with the lowest price per unit. |
| Prompt | What to make, in any language. For a voice, the text it reads. |
| Voice | For a voice: loaded from the chosen model. |
| Seconds | For a video, such as 5 or 10. |
| Resolution | Such as `480p`, `720p`, `1080p` or `2k`. Empty uses the default. |
| Aspect Ratio | `16:9`, `9:16`, `1:1`, `4:5` and more. |
| Image URLs | Public links: one image is the first frame of a video, two are the first and last frames, more are references (for example Nano Banana Pro with a product and a scene). |
| Additional Fields | Mode, Seed, Sound (on or off), Webhook URL, Idempotency Key and Agreed Credits (a total from Quote; if the price changed, nothing is charged). |

The output is the generation (`id`, `status`, `credits_charged`, `seed`, `output`, `outputs`) plus `url`, the link to the file, valid for 6 hours. Download it with an **HTTP Request** node (response format: File) to get binary data.

With **Wait for Completion** off, the node returns right away with `status: processing`; read it later with **Get**, or set a **Webhook URL**.

When the model refuses the content (`SAFETY_BLOCKED`, `COPYRIGHT_BLOCKED`, `REAL_FACES_BLOCKED`) or the generation fails, the node fails with that code and the credits come back on their own.

### Generation: Quote

The exact price in credits of the same fields, without generating anything. Use it before Generate when a person must approve the cost.

### Generation: Get

Reads a generation by id. **Wait for Completion** holds the answer up to 60 seconds while it is still processing.

### Model: Get Many

Lists the models with their modes, resolutions, seconds, voices and prices, one item per model. Filter by kind, or only the featured ones.

## Example workflows

Ready to import workflows (Seedance 2.5 text to video, Wan 3 image to video, Nano Banana Pro with references, Gemini TTS) are in [getcutpro/examples](https://github.com/getcutpro/examples/tree/main/n8n), including a version that uses only the built-in HTTP Request node.

## Errors

API errors carry a stable code, such as `INSUFFICIENT_CREDITS`, `PRICE_CHANGED`, `SECONDS_INVALID` (the allowed values come in the details) or `TOO_MANY_RUNNING`. Every code is explained in the [error catalog](https://cut.pro/docs/en/errors).

## Compatibility

Built with `@n8n/node-cli` 0.55 against `n8n-workflow` 2.x. No runtime dependencies.

## Resources

- [Cut.Pro generation guide](https://cut.pro/docs/en/generations)
- [Model catalog and prices](https://cut.pro/en/models)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

MIT

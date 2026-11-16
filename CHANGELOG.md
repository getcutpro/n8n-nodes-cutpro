# Changelog

## 0.1.3 (2026-11-16)

- Errors from the node now show the plain Cut.Pro error code as the message (for example `SAFETY_BLOCKED`) instead of a sentence, so you can match on it in error workflows.
- A generation that is still processing when the wait runs out now fails with `WAIT_TIMEOUT`. The generation ID and how to read it later are in the error description.
- A failed generation now fails with its error code, or `GENERATION_FAILED` when none is returned.
- The credential now sends the node's `User-Agent` itself, so Cut.Pro can tell the node's requests apart from the HTTP Request node, including the credential test.

## 0.1.2 (2026-11-07)

- Identifies itself to the API as `n8n-nodes-cutpro/<version>`.

## 0.1.1 (2026-11-06)

- Published from GitHub Actions with npm provenance.

## 0.1.0 (2026-11-06)

- First release: one Cut.Pro node with Generation (Generate, Get, Quote) and Model (Get Many) operations, and the Cut.Pro API credential.
- Generate quotes the request, agrees to the quoted total and can wait for the file, returning its link in `url`.
- Model and voice pickers load from the live catalog.

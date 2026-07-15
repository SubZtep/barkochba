# Kaja CLI  !¡ :feelsgood:

## Config

> _<sub>Everything is temporary.</sub>_

Fill all the fields here here: `~/.config/kaja/config.json`

```json
{
  braveApiKey: "",
  openaiApiBaseUrl: "",
  openaiApiKey: "",
  openaiApiModel: "",
  geoServiceUrl: "https://few-booklet-31770.ondis.co/",
  geoServiceApiKey: "019ea05a-eacc-7ce7-8af9-e0cbf842d483"
}
```

### Collect Credentials

- **Brave search**: get a free key from [their website](https://brave.com/search/api/).

- **OpenAI API**: your LLM need to be compatible to the most popular format. My values:
  - openaiApiBaseUrl: `https://api.fireworks.ai/inference/v1`
  - openaiApiModel: `accounts/fireworks/models/minimax-m3`

- **Geo service**: the example URL and API key will work for a while.

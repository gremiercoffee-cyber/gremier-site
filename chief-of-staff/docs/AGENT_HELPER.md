# Asking Yoni's computer helper to do something in a browser (for Codex / Claude Code)

Yoni has a "computer helper": Chrome on his home computer, signed in as him, driven by his Chief of Staff.
Use it when a task needs something done in a website that you can't do yourself: sign up for a service, click
"Enable" in a cloud console, accept an OAuth screen, fill in a web form. Don't use it for anything you can do
with an API or the command line.

Every request waits for Yoni to tap **Allow** on his phone. It never types passwords (Chrome's saved passwords
fill those), never pays, and asks Yoni when it hits a CAPTCHA, a text-message code or a choice.

## Ask
```bash
curl -s -X POST https://chief-of-staff.gremiercoffee.workers.dev/api/agent/helper-jobs \
  -H "content-type: application/json" \
  -H "x-agent-key: $(tr -d ' \r\n' < /c/Users/Yoni/.tokens/cos-agent-key.txt)" \
  -d '{"from":"Codex","instruction":"In Google Cloud console, project chief-of-staff, enable the People API.","start_url":"https://console.cloud.google.com/apis/library/people.googleapis.com"}'
```
Reply: `{"id":"…","status":"waiting_approval"}`. Write the instruction completely: which site, what to do, and
what counts as done (e.g. "…then tell me the API key it shows"). Never put secrets in the instruction.

## Check on it
```bash
curl -s https://chief-of-staff.gremiercoffee.workers.dev/api/agent/helper-jobs/<id> \
  -H "x-agent-key: $(tr -d ' \r\n' < /c/Users/Yoni/.tokens/cos-agent-key.txt)"
```
`status`: waiting_approval → queued → running → done / failed / cancelled (or needs_you: Yoni is being asked
something on his phone). `result` says what it did. Check every 30-60 seconds; tell Yoni you've asked and that
he'll get an Allow prompt on his phone.

The key is in `C:\Users\Yoni\.tokens\cos-agent-key.txt` on Yoni's computer. Never print it or commit it.
In a cloud session without that file, ask Yoni to add the key as a secret environment variable `COS_AGENT_KEY`
and use that instead.

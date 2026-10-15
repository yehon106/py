# Cronoff code server (made by yehon106)

Cronoff runs these languages **in the browser, no internet needed after the first visit**:
Python, JavaScript, TypeScript, SQL, Lua, Ruby, C/C++.

These languages **cannot** run in a browser, so they use a code server (they need internet):
Java, C#, Go, Rust, Kotlin. They show "(online)" in the language list.

If you skip this guide, everything local keeps working. The server languages just say
"No code server is connected yet".

## Free way (no money): Judge0 on RapidAPI

RapidAPI hosts Judge0 and has a free "Basic" plan with **50 runs per day** (shared by everyone who uses your site).
It runs Java, C#, Go, Rust and Kotlin for you. If it asks for a payment card, stop: use the local languages instead.

1. Go to https://rapidapi.com/judge0-official/api/judge0-ce/pricing and choose the **Basic** (free) plan. Make an account.
2. Open https://rapidapi.com/judge0-official/api/judge0-ce/ and copy your **X-RapidAPI-Key** (your secret key).
3. In Vercel: your project, Settings, Environment Variables. Add these three:

| Name | Value |
| --- | --- |
| RUNNER_URL | https://judge0-ce.p.rapidapi.com |
| RUNNER_TYPE | judge0 |
| RUNNER_HEADERS | {"X-RapidAPI-Key":"PASTE_YOUR_KEY","X-RapidAPI-Host":"judge0-ce.p.rapidapi.com"} |

4. Also add `ACCESS_CODE` with a secret word you choose. Otherwise anyone who finds your site can use up your 50 runs.
5. Deployments, Redeploy (settings only apply to new deployments).
6. Reload Cronoff. "Java (online)" and the others now appear in the language list.

Java there is OpenJDK 13. Name your class `Main` (see "file names" below).

## Other options (only if you want more than 50 runs a day)

### Option A: Piston on your own server

On the server (Linux with Docker installed):

```
git clone https://github.com/engineer-man/piston
cd piston
docker-compose up -d api
```

Then install the languages you want (from the piston folder, with Node installed):

```
cli/index.js -u http://localhost:2000 ppman install java
cli/index.js -u http://localhost:2000 ppman install mono
cli/index.js -u http://localhost:2000 ppman install go
cli/index.js -u http://localhost:2000 ppman install rust
cli/index.js -u http://localhost:2000 ppman install kotlin
```

Piston has **no password**. Never leave port 2000 open to the internet. Put a reverse proxy in front
that needs a secret header. Example with Caddy (replace the domain and the secret):

```
piston.example.com {
	@ok header X-Token YOUR_LONG_RANDOM_SECRET
	handle @ok {
		reverse_proxy localhost:2000
	}
	handle {
		respond 403
	}
}
```

Vercel settings for option A:

| Name | Value |
| --- | --- |
| RUNNER_URL | https://piston.example.com |
| RUNNER_HEADERS | {"X-Token":"YOUR_LONG_RANDOM_SECRET"} |

### Option B: Judge0 elsewhere

| Name | Value |
| --- | --- |
| RUNNER_URL | the base URL from your provider |
| RUNNER_TYPE | judge0 |
| RUNNER_HEADERS | the key headers your provider tells you to send, as JSON |

If a language does not run, the provider's language ids may differ. Override them with
`JUDGE0_IDS`, for example `{"java":62,"go":95}`.

## Vercel steps (about 5 minutes)

1. Upload `api/run.js` to your GitHub repo. It must be at `api/run.js` (a folder named `api`).
2. In Vercel: your project, Settings, Environment Variables. Add the names above.
3. Optional but recommended: add `ACCESS_CODE` with a secret word. Cronoff then asks for it once and remembers it on that device. Without it, anyone who finds your site can use your server.
4. Deployments, Redeploy (settings only apply to new deployments).
5. Open Cronoff, pick Java, type a program and press Run.

## Java and the other languages: file names

The server saves your code as `Main.java`, `Main.cs`, `main.go`, `main.rs` or `Main.kt`.
For Java and C# name your main class `Main`:

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}
```

Input for the program goes in the box above the output (one line per input). It is sent when you press Run,
because server programs cannot ask for input while they run.

## Safety

- The runner executes anyone's code that reaches it. Use a sandboxed runner (Piston in Docker is), never your own computer or a server that holds anything private.
- `api/run.js` limits each visitor to 12 runs per minute, code to 64 KB, and only accepts calls from your own site.
- Set `ACCESS_CODE` unless you want the server public.

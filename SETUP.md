# Put AP Desk online

This gives you your own website where you can upload real invoices. Sarvam reads them. About 20–30 minutes, once. Gmail comes later.

You'll create two free accounts and copy a few values into GitHub. **Never paste keys or passwords into a chat.** Paste them only into the settings pages named below.

## 1. Supabase (the back office: database, files, invoice reading)

1. Go to https://supabase.com, click **Start your project**, and sign in with GitHub.
2. Click **New project**:
   - Name: `ap-desk`
   - Database password: click **Generate a password**, then **copy it somewhere safe** (you need it in step 3).
   - Region: **South Asia (Mumbai)**
   - Click **Create new project** and wait about 2 minutes.
3. Collect three values:
   - **Project ref:** the part of the address bar after `/project/`, e.g. `abcdefghijklmnop`.
   - **Database password:** from step 2.
   - **Access token:** your profile picture (bottom left) → **Account preferences** → **Access Tokens** → **Generate new token** → name it `github` → copy it.
4. Under **Project Settings → API**, note the **Project URL** and the **anon public** key, for Vercel in step 4. These two are safe to put in a website.

## 2a. If you linked Supabase to GitHub (Supabase → Integrations → GitHub)

This replaces steps 2 and 3. Supabase deploys straight from the repo.

1. In Supabase → **Project Settings → Integrations → GitHub**, check:
   - **Supabase directory:** `.`
   - **Production branch:** `main`
   - **Deploy to production:** on
2. Add your Sarvam key on the Supabase side: **Edge Functions → Secrets** (or Project Settings → Edge Functions) → add `SARVAM_API_KEY`.
3. After Claude's next change, check:
   - **Table Editor** lists `bills`, `vendors`, `emails` and the other tables;
   - **Edge Functions** lists `extract-invoice`, `bill-actions`, `validate-bill` and others (8 in total).

   If the tables are there but the functions aren't, tell Claude: your Supabase plan may not deploy functions from GitHub, and steps 2–3 below do it instead.

Then go to step 4.

## 2. GitHub secrets (so changes deploy themselves)

Open https://github.com/Aonx-bt/AP_vendor/settings/secrets/actions and click **New repository secret** for each:

| Name | Value |
|---|---|
| `SUPABASE_PROJECT_REF` | the project ref |
| `SUPABASE_DB_PASSWORD` | the database password |
| `SUPABASE_ACCESS_TOKEN` | the access token |
| `SARVAM_API_KEY` | your Sarvam key |

## 3. Deploy the back office

Open https://github.com/Aonx-bt/AP_vendor/actions → **Deploy backend** → **Run workflow** → **Run workflow**. Wait for the green tick, about 2–3 minutes. If it shows a red cross, open it and send Claude the error text (not your keys).

From now on this runs by itself whenever Claude changes the back office.

## 4. Vercel (the website)

1. Go to https://vercel.com/new and sign in with GitHub. If asked, allow access to the **AP_vendor** repository.
2. Click **Import** next to AP_vendor.
3. Open **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = the Project URL from step 1.4
   - `VITE_SUPABASE_ANON_KEY` = the anon public key from step 1.4
4. Click **Deploy**. After about a minute you get your address, like `ap-vendor.vercel.app`.

From now on the website updates by itself whenever Claude changes it.

## 5. Try it

1. Open your Vercel address. There's no "Demo mode" badge now.
2. **Settings → Mailbox → Reset demo data → type DELETE.** This loads the sample vendors, approval rules and bills. Do it once, at the start.
3. **Bills → Add Bill** and upload a real invoice (PDF, PNG or JPG, under 10 MB).
4. Sarvam reads it in about 5–15 seconds and the bill opens. If the vendor is new, click **Add as new vendor** in Vendor details.

## Good to know

- **No login yet:** anyone with your website address can see what you upload. Use test invoices until a login is added.
- **Free Supabase projects pause after about a week without use.** Open supabase.com and click **Restore project**; your data is kept.
- **Rollback:** in Vercel → your project → Deployments → pick an earlier one → **Instant rollback**.

## Connect Gmail

AP Desk checks one Gmail inbox every minute. Every email is sorted first, and only invoices are read: the PDF or photo goes to Sarvam, then the checks and approval routing run. Credit notes, quotes, statements, auto-replies and newsletters are listed in Settings → Mailbox with the reason. The same inbox sends "Request info from vendor" emails, and vendor replies attach to the same bill.

Use a **dedicated inbox**: everything in it is sorted by the app. About 10 minutes, once. Do steps 1–5 **signed in to Google as that inbox**.

1. Go to https://console.cloud.google.com, open the project picker (top left), click **New project**, name it `AP Desk`, then **Create** and select it.
2. Open ☰ → **APIs & Services → Library**, search **Gmail API**, then click **Enable**.
3. Open ☰ → **APIs & Services → OAuth consent screen** (also called **Google Auth Platform**) and click **Get started**:
   - App name `AP Desk`; user support email: the inbox.
   - **Audience: External**. (Choose **Internal** instead if the inbox is a Google Workspace address.)
   - Contact email: the inbox. Agree, then **Create**.
4. Go to **Audience** → **Publish app** → **Confirm**. Left in "Testing", Google cuts the connection every 7 days. Google's verification isn't needed for your own inbox.
5. Go to **Clients** → **Create client**:
   - Application type: **Web application**; name `AP Desk`.
   - **Authorized redirect URIs** → **Add URI**: `https://ulwaqfiyxkfmpqjauxgx.supabase.co/functions/v1/gmail-oauth`
   - Click **Create**, then copy the **Client ID** and **Client secret**.
6. On GitHub, open https://github.com/Aonx-bt/AP_vendor/settings/secrets/actions and add three secrets:

   | Name | Value |
   |---|---|
   | `GMAIL_CLIENT_ID` | the Client ID |
   | `GMAIL_CLIENT_SECRET` | the Client secret |
   | `APP_URL` | `https://ap-vendor.vercel.app` |

7. Go to https://github.com/Aonx-bt/AP_vendor/actions → **Deploy backend** → **Run workflow**, and wait for the green tick.
8. On your website, open **Settings → Mailbox → Connect Gmail**:
   - pick the inbox;
   - Google says "Google hasn't verified this app": click **Advanced → Go to AP Desk (unsafe)**. It's your own app;
   - tick the permission and click **Continue**.

   You're sent back to AP Desk, which shows **Connected as …@gmail.com**.
9. **Test it.** From another email account, send an invoice PDF to the inbox. Within about 1–2 minutes it appears under **Bills**, with its stages on **Runs**. Click **Check now** to check immediately.

**If it stops working:** Google drops the connection if the inbox password changes or access is removed. Mailbox then shows a message and a **Connect again** button. Attachments over 25 MB arrive as Drive links, and those emails are flagged for a person.

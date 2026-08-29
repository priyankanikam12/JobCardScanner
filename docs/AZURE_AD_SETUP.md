# Azure AD (Microsoft Entra ID) Setup for JobCardScanner

JobCardScanner authenticates **workshop staff** (Service Advisor, Technician, Workshop
Manager, Parts User, Cashier, Dealer Admin, Corporate Admin, System Admin) through your
organization's Azure AD tenant, on both the web app and the Android app. Customers do
**not** use Azure AD - they sign in to the tracking portal with mobile number + OTP (see
`backend/JobCardScanner.Api/Services/Integrations/OtpService.cs`), so nothing below applies
to the customer-facing side of the product.

You need an Azure subscription with permission to create App Registrations (Application
Administrator or Global Administrator in Microsoft Entra ID, or a Cloud Application
Administrator role). This whole setup takes about 10 minutes and only needs to be done once
per environment (once for dev/test, again for production if you use a separate tenant or
just separate redirect URIs).

## Why two App Registrations

- **JobCardScanner API** - represents the ASP.NET Core backend. It exposes one permission
  ("scope") that client apps ask permission to call.
- **JobCardScanner Client** - represents the *apps that sign users in*: the React web app
  and the React Native Android app both use this same registration (a single "public
  client" App Registration can have both a Single-Page Application redirect and a
  Mobile/Desktop redirect configured on it).

## Part 1 - Register the API

1. Go to [portal.azure.com](https://portal.azure.com) and sign in with an account that can
   manage App Registrations.
2. Search for **"App registrations"** (or navigate via Microsoft Entra ID > App
   registrations) and click **+ New registration**.
3. Fill in:
   - **Name**: `JobCardScanner API`
   - **Supported account types**: "Accounts in this organizational directory only
     (Single tenant)" - unless your dealer network spans multiple Azure tenants, in which
     case pick the multi-tenant option.
   - **Redirect URI**: leave blank (APIs do not need one).
4. Click **Register**.
5. On the Overview page, copy and save:
   - **Application (client) ID** -> this is your `AzureAd:ClientId` / `AzureAd:Audience`
     value in `appsettings.json`.
   - **Directory (tenant) ID** -> this is your `AzureAd:TenantId`.
6. In the left menu, click **Expose an API**.
   - Click **Add** next to "Application ID URI". Accept the default
     `api://<the-client-id-you-just-copied>` and click **Save**.
   - Click **+ Add a scope**.
     - **Scope name**: `access_as_user`
     - **Who can consent**: Admins and users
     - **Admin consent display name**: `Access JobCardScanner API`
     - **Admin consent description**: `Allows staff sign-in to the JobCardScanner workshop app.`
     - **State**: Enabled
   - Click **Add scope**.

You now have a scope identified as `api://<api-client-id>/access_as_user` - the client apps
will ask for exactly this string.

## Part 2 - Register the Client (web + Android)

1. Back at **App registrations**, click **+ New registration** again.
2. Fill in:
   - **Name**: `JobCardScanner Client`
   - **Supported account types**: same choice as Part 1.
   - **Redirect URI**: select platform **Single-page application (SPA)** and enter
     `http://localhost:5173` (the Vite dev server). You can add your production web URL
     (e.g. `https://jobcards.yourdealer.com`) later the same way.
3. Click **Register**, then copy the **Application (client) ID** - this is a *different* ID
   from the API's. Save it as your web/mobile `AZURE_CLIENT_ID`.
4. In the left menu, click **Authentication**.
   - Under **Platform configurations**, click **+ Add a platform** again and choose
     **Mobile and desktop applications**.
   - Add this custom redirect URI for the Android app (Expo/AuthSession):
     `jobcardscanner://auth`
   - If you are testing inside the Expo Go app (not a standalone build) also add the Expo
     proxy redirect shown by `expo-auth-session` at runtime, typically
     `https://auth.expo.io/@your-expo-username/jobcardscanner` - `mobile/README.md` explains
     how to read the exact value from the running app and add it here.
   - Scroll down to **Advanced settings** and set **Allow public client flows** to **Yes**
     (required - neither the SPA nor the mobile app has a client secret; both use the
     Authorization Code + PKCE flow).
   - Click **Save**.
5. In the left menu, click **API permissions**.
   - Click **+ Add a permission** > **My APIs** > **JobCardScanner API**.
   - Choose **Delegated permissions**, check **access_as_user**, click **Add permissions**.
   - Click **Grant admin consent for `<your tenant>`** and confirm. (If you don't have
     admin rights, each user will instead see a one-time consent prompt on first sign-in.)

## Part 3 - Configure the projects

**Backend** - `backend/JobCardScanner.Api/appsettings.json` (or better, `dotnet user-secrets`
so real values never get committed):

```json
"AzureAd": {
  "Instance": "https://login.microsoftonline.com/",
  "TenantId": "<directory (tenant) ID from Part 1>",
  "ClientId": "<API application (client) ID from Part 1>",
  "Audience": "api://<API application (client) ID from Part 1>"
}
```

**Web** - `web/.env` (copy from `web/.env.example`):

```
VITE_AZURE_CLIENT_ID=<Client application (client) ID from Part 2>
VITE_AZURE_TENANT_ID=<Directory (tenant) ID from Part 1>
VITE_AZURE_API_SCOPE=api://<API application (client) ID from Part 1>/access_as_user
VITE_API_BASE_URL=https://localhost:5001
```

**Mobile** - `mobile/.env` (copy from `mobile/.env.example`), same three Azure values plus
your API's reachable URL (an Android emulator cannot reach `localhost` on your PC - use your
machine's LAN IP or `10.0.2.2` for the standard Android emulator):

```
AZURE_CLIENT_ID=<Client application (client) ID from Part 2>
AZURE_TENANT_ID=<Directory (tenant) ID from Part 1>
AZURE_API_SCOPE=api://<API application (client) ID from Part 1>/access_as_user
API_BASE_URL=http://10.0.2.2:5000
```

## Part 4 - Provision your staff users

Azure AD only proves *who someone is*; JobCardScanner's own `Users` table decides *what
they can do* (their role and dealer). This is a deliberate simplification so you don't have
to configure Azure AD App Roles or Enterprise Application role assignments - see the doc
comment on `backend/JobCardScanner.Api/Auth/AppClaimsTransformation.cs` for the mechanics.

Before someone can sign in successfully:

1. A Dealer Admin, Corporate Admin, or System Admin adds them from **Admin > Users** in the
   web app (or via `POST /api/users`), using **the exact email/UPN they sign in to Azure AD
   with**.
2. The first time they sign in, the backend automatically stamps their Azure AD object ID
   onto that row and lets them in with the role you assigned.
3. If someone's email in Azure AD doesn't match a row in the `Users` table, they will see
   "Your Azure AD account is not provisioned in JobCardScanner" after a successful Azure AD
   sign-in - this is expected until an admin adds them.

The seed data in `backend/JobCardScanner.Api/Data/DbSeeder.cs` includes a `SystemAdmin` row
for `vijay.maurya@bgauss.com` - update that email (or add your own) to match a real Azure AD
account in your tenant before your first sign-in, otherwise nobody will be able to reach the
Admin screens to provision anyone else.

## Troubleshooting

- **AADSTS50011 (redirect URI mismatch)**: the redirect URI your app is actually using
  (check the browser address bar or Expo logs) must be added *verbatim* under the client
  App Registration's Authentication blade.
- **AADSTS65001 (consent required)**: grant admin consent in Part 2 step 5, or have each
  user click "Accept" on their first sign-in consent prompt.
- **401 from the API after a successful sign-in**: double check `AzureAd:Audience` in
  `appsettings.json` matches the API App Registration's Application ID URI exactly
  (`api://<api-client-id>`), and that the client is requesting that exact scope.
- **"not provisioned" message**: see Part 4 - add the user's email to the `Users` table.

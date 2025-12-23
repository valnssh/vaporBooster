<div align="center">

<img src="static/favicon.svg" alt="vaporBooster" width="120" height="120">

# vaporBooster

### Simple, fast and reliable hour booster for the Steam platform.

[![Docker](https://img.shields.io/badge/Docker-29.x-2263EC?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Deno](https://img.shields.io/badge/Deno-2.x-6FFFAE?style=for-the-badge&logo=deno&logoColor=white)](https://deno.land/)
[![Svelte](https://img.shields.io/badge/Svelte-5.x-FF4608?style=for-the-badge&logo=svelte&logoColor=black)](https://svelte.dev/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-4.x-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)

</div>

---

## Screenshots

<div align="center">
  <img src="screenshots/oidc.png" alt="OIDC redirect">
  <img src="screenshots/dashboard.png" alt="Dashboard">
  <img src="screenshots/add_steam_account.png" alt="Add Steam Account">
  <img src="screenshots/steam_guard_required.png" alt="Application asks for Steam Guard code">
  <img src="screenshots/steam_guard_code.png" alt="Enter Steam Guard code">
  <img src="screenshots/account_settings.png" alt="Add games to boost">
  <img src="screenshots/boosting.png" alt="Boosting Hours">
  <img src="screenshots/messages.png" alt="Messages">
  <img src="screenshots/confirm_account_deletion.png" alt="Confirm account deletion">
</div>

---

## Deploy

### 1. Configure environment variables

Copy the example file and set the required variables:

```bash
cp .env.example .env
```

Generate a secure 32+ character secret for `BETTER_AUTH_SECRET`:

```bash
openssl rand -base64 32
```

Edit the `.env` file and paste the generated value:

```env
BETTER_AUTH_SECRET=<your_generated_secret>
```

### 2. Start with Docker Compose

```bash
docker compose up -d
```

### 3. Access the application

By default, the application will be available at: **http://localhost:8000**

---

## Authentication (Optional)

By default, the application **does not require authentication**. Anyone with access to the URL can use it.

### Configure an OIDC provider

If you want to add authentication, you can configure an OpenID Connect provider (such as [Keycloak](https://github.com/keycloak/keycloak), [Authentik](https://github.com/goauthentik/authentik), [Pocket ID](https://github.com/pocket-id/pocket-id), etc.) by adding the following variables to your `.env`:

```env
OIDC_PROVIDER_NAME=My Provider
OIDC_PROVIDER_ID=my-provider
OIDC_CLIENT_ID=your_client_id
OIDC_CLIENT_SECRET=your_client_secret
OIDC_DISCOVERY_URL=https://your-provider/.well-known/openid-configuration
```

> [!NOTE]
> If you don't configure an OIDC provider, the application will work without authentication.

---

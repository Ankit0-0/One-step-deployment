import { loadWebEnv } from '@osd/config';

// NEXT_PUBLIC_* must be referenced literally so Next inlines them into the client bundle.
export const env = loadWebEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_ROOT_DOMAIN: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
});

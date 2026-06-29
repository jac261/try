const DEFAULT_API_BASE_URL = 'http://localhost:5032';

function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  return trimmed || DEFAULT_API_BASE_URL;
}

function describeError(error) {
  return error instanceof Error ? error.message : 'Unexpected API error.';
}

function parseJson(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

export const apiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);

export async function getAuthTest(getToken) {
  if (typeof getToken !== 'function') {
    return { ok: false, status: null, message: 'Clerk is not ready yet.' };
  }

  let token = '';

  try {
    token = await getToken();
  } catch (error) {
    return { ok: false, status: null, message: describeError(error) };
  }

  if (!token) {
    return { ok: false, status: null, message: 'No Clerk session token is available.' };
  }

  try {
    const response = await fetch(apiBaseUrl + '/api/auth-test', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + token,
      },
    });
    const bodyText = await response.text();
    const body = parseJson(bodyText);

    if (!response.ok) {
      const serverMessage = body && body.error && body.error.message ? body.error.message : bodyText;
      return {
        ok: false,
        status: response.status,
        message: serverMessage || ('API returned ' + response.status + '.'),
        body: body || bodyText,
      };
    }

    return { ok: true, status: response.status, body };
  } catch (error) {
    return { ok: false, status: null, message: describeError(error) };
  }
}

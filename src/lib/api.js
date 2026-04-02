const API = 'https://script.google.com/macros/s/AKfycbyxFvNQjWvF6Ckajd_H-OZ8WsXixoCWtjSxtChs8SmpL5CvidjT5P161tn0RXgYawd3sg/exec';

export async function api(action) {
  const res = await fetch(API + '?action=' + action + '&_t=' + Date.now());
  if (!res.ok) throw new Error('API error: ' + res.status);
  return res.json();
}

export async function apiPost(body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  });
  return res.json();
}

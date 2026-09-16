export function serviceAuthHeaders(): Record<string, string> {
  const token = process.env.BABEL_SERVICE_TOKEN?.trim();
  if (!token) return {};
  return {
    authorization: `Bearer ${token}`,
    "x-babel-service-token": token,
  };
}

/** These test harnesses destroy data. Only explicitly designated loopback databases are allowed. */
export function disposableDatabaseUrl(value: string | undefined, name: 'meetfolio_test' | 'meetfolio_e2e'): string {
  if (!value || process.env.MEETFOLIO_ALLOW_TEST_DB_RESET !== name) {
    throw new Error(`Set the database URL and MEETFOLIO_ALLOW_TEST_DB_RESET=${name} for a disposable local database.`);
  }
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== `/${name}` || url.search || url.hash) {
    throw new Error(`Refusing database reset: expected loopback PostgreSQL database ${name} without URL parameters.`);
  }
  return value;
}

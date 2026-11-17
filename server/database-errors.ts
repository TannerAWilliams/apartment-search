// Connection failures can include URLs and credentials. Never log the error.
export function databaseCloseReporter(report: (message: string) => void = console.error) {
  return (error: Error | null) => {
    if (error) {
      report('Database connection interrupted; subsequent requests will retry a connection.');
    }
  };
}

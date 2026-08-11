export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center text-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="mt-2 text-muted-foreground">This page could not be found.</p>
      <a href="/" className="btn btn-primary mt-4">Go home</a>
    </div>
  );
}

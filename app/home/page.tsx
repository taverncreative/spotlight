// The empty single-operator home: a calm placeholder until the first modules
// land along the bottom bar.
export default function HomePage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-lg font-medium">Welcome to Spotlight</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your agency console. Client tools will appear here as modules are added.
      </p>
    </div>
  );
}

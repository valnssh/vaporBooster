CREATE TABLE "_hoursbooster_sqlite_import" (
	"id" integer PRIMARY KEY NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);

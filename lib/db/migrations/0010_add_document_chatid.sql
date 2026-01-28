-- Add chatId column to Document table to link reports to their originating chat
ALTER TABLE "Document" ADD COLUMN "chatId" uuid REFERENCES "Chat"("id");

-- Create index for efficient lookup of documents by chatId
CREATE INDEX "Document_chatId_idx" ON "Document" ("chatId");

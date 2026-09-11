-- Create unique index on payment_evidence_verifications(payload_hash) where payload_hash is not null
CREATE UNIQUE INDEX IF NOT EXISTS "idx_verification_payload_hash_unique" 
ON "payment_evidence_verifications"("payload_hash") 
WHERE "payload_hash" IS NOT NULL;

-- Add XOR CHECK constraint on payment_evidence_verifications
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_verification_xor_anchor'
    ) THEN
        ALTER TABLE "payment_evidence_verifications" 
        ADD CONSTRAINT "chk_verification_xor_anchor" 
        CHECK (
            ("payment_id" IS NOT NULL AND "payment_group_id" IS NULL) 
            OR 
            ("payment_id" IS NULL AND "payment_group_id" IS NOT NULL)
        );
    END IF;
END $$;

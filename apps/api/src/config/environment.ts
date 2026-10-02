import dotenv from 'dotenv';
import path from 'node:path';

// Load the repository-level environment file from both tsx and compiled API paths,
// then fall back to apps/api/.env for deployments that keep service-local config.
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

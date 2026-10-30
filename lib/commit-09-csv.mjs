import { putGithubFile } from './github-put-file.mjs';

export const CSV09_REPO_PATH = 'config/09-url-target-keywords.csv';

export async function commitCsv09(csv, message) {
  return putGithubFile({
    owner: 'alanranger',
    repo: 'ai-geo-audit',
    path: CSV09_REPO_PATH,
    content: csv,
    message: message || 'chore(seo): save 09-url-target-keywords.csv'
  });
}

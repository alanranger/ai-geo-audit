# Debug Logs

This directory contains automatically generated debug logs from audit runs.

## File Naming

Logs are saved with the format: `debug-log-{property-slug}-{date}.txt`

Example: `debug-log-www-alanranger-com-2025-12-20.txt`

## Cleanup

To delete old logs:
- Delete individual files by date
- Or delete all files in this folder to start fresh
- The `.gitkeep` file should remain to keep the folder tracked in git

## Automatic Saving

Debug logs are automatically saved after each audit scan completes (success or failure). No manual action required.



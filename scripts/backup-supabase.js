import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Supabase config
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// Create backup directory if it doesn't exist
const backupDir = path.join(__dirname, '..', 'backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Get all tables from Supabase
async function getAllTables() {
  try {
    const { data, error } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public');

    if (error) throw error;
    return data.map(t => t.table_name);
  } catch (error) {
    console.error('Error getting tables:', error.message);
    return [];
  }
}

// Fetch data from a table
async function fetchTableData(tableName) {
  try {
    const { data, error, count } = await supabase
      .from(tableName)
      .select('*', { count: 'exact' });

    if (error) throw error;
    return { data: data || [], count };
  } catch (error) {
    console.error(`Error fetching ${tableName}:`, error.message);
    return { data: [], count: 0 };
  }
}

// Create Excel workbook with all tables
async function createBackupExcel(tables) {
  const workbook = new ExcelJS.Workbook();

  // Add metadata sheet
  const metaSheet = workbook.addWorksheet('_Metadata');
  metaSheet.columns = [
    { header: 'Key', key: 'key', width: 20 },
    { header: 'Value', key: 'value', width: 40 }
  ];

  const backupDate = new Date().toISOString();
  metaSheet.addRows([
    { key: 'Backup Date', value: backupDate },
    { key: 'Total Tables', value: tables.length },
    { key: 'Supabase Project', value: SUPABASE_URL }
  ]);

  // Fetch and add data from each table
  for (const tableName of tables) {
    try {
      console.log(`Backing up table: ${tableName}...`);
      const { data, count } = await fetchTableData(tableName);

      if (count > 0) {
        const worksheet = workbook.addWorksheet(tableName);

        if (data.length > 0) {
          // Get column names from first row
          const columns = Object.keys(data[0]).map(key => ({
            header: key,
            key: key,
            width: 15
          }));

          worksheet.columns = columns;
          worksheet.addRows(data);

          console.log(`✓ Backed up ${tableName}: ${count} records`);
        }
      }
    } catch (error) {
      console.error(`Failed to backup ${tableName}:`, error.message);
    }
  }

  // Save the workbook
  const filename = `backup_${new Date().toISOString().split('T')[0]}_${new Date().getHours()}-${new Date().getMinutes()}.xlsx`;
  const filepath = path.join(backupDir, filename);

  await workbook.xlsx.writeFile(filepath);
  console.log(`\n✅ Backup completed: ${filepath}`);
  return filepath;
}

// Main backup function
async function runBackup() {
  console.log('🔄 Starting Supabase backup...');
  console.log(`Supabase URL: ${SUPABASE_URL}`);

  try {
    const tables = await getAllTables();
    console.log(`Found ${tables.length} tables: ${tables.join(', ')}`);

    if (tables.length > 0) {
      await createBackupExcel(tables);
    } else {
      console.log('No tables found to backup.');
    }
  } catch (error) {
    console.error('Backup failed:', error);
    process.exit(1);
  }
}

// Run the backup
runBackup();

(() => {
  'use strict';
  const engines = {PostgreSQL:5432, MySQL:3306, 'SQL Server':1433, SQLite:null};
  const roots = {'Real History':'samples/history','EU4':'samples/eu4','Anbennar':'samples/anbennar'};
  const extensions = ['csv','json','txt','md','pdf'];
  const samples = {
    'Real History': [['FR','Kingdom of France','Charles VII'],['EN','Kingdom of England','Henry VI']],
    EU4: [['FRA','France','Charles VII'],['ENG','England','Henry VI']],
    Anbennar: [['A01','Lorent','Kylian VI'],['A03','Redglades','Elthariel']]
  };
  function databaseSettings(source = {}, engine = source.format || 'PostgreSQL') {
    if (!Object.hasOwn(engines,engine)) throw new Error('Choose a supported database engine.');
    const c = source.connection || {};
    if (engine === 'SQLite') return {engine,file:c.file || 'samples/databases/atlas.sqlite'};
    const old = /^(\[[^\]]+\]|[^/@:]+)(?::(\d+))?\/([^/]+)$/.exec(source.loc || '');
    return {engine,host:c.host || old?.[1] || (source.loc ? '' : 'archive.example.test'),
      port:c.port || old?.[2] || engines[engine],database:c.database || old?.[3] || 'atlas',
      username:c.username ?? ''};
  }
  function localPath(value, relative = false) {
    const path = String(value || '').trim(), parts = path.replace(/\\/g,'/').split('/');
    const withoutDrive = path.replace(/^[A-Z]:[\\/]/i,'');
    if (!path || path.length > 1024 || /[\x00-\x1f:<>|?*"]/u.test(withoutDrive) || parts.some(part => part === '..' || part === '.') ||
        (relative && /^(?:[a-z]:|[\\/])/i.test(path))) throw new Error(relative ?
      'Enter a subfolder relative to the managed root, without parent directory segments.' : 'Enter a local directory or file path without a URL or parent directory segments.');
    return path;
  }
  function connection(input) {
    const engine = input?.engine;
    if (!Object.hasOwn(engines,engine)) throw new Error('Choose a supported database engine.');
    if (engine === 'SQLite') {
      const file = localPath(input.file);
      if (!/\.(sqlite3?|db)$/i.test(file)) throw new Error('Enter a SQLite file ending in .sqlite, .sqlite3 or .db.');
      return {engine,file};
    }
    let host = String(input.host || '').trim();
    const port = Number(input.port);
    const database = String(input.database || '').trim(), username = String(input.username || '').trim();
    if (host.includes(':')) {
      const literal = host.replace(/^\[|\]$/g,'');
      if (!/^[a-f0-9:.]+$/i.test(literal)) throw new Error('Enter an IPv6 address without a port.');
      try { host = new URL('http://['+literal+']/').hostname; } catch { throw new Error('Enter a valid IPv6 address.'); }
    } else if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host))
      throw new Error('Enter a host name or IP address without a port or URL.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a port from 1 to 65535.');
    if (!database || database.length > 128 || /[\x00-\x1f/\\@?#]/u.test(database)) throw new Error('Enter a database name without a URL or connection string.');
    if (username.length > 128 || /[\x00-\x1f]/.test(username)) throw new Error('Enter a valid sample username.');
    return {engine,host,port,database,username};
  }
  function address(c) {
    return c.engine === 'SQLite' ? c.file : c.host + ':' + c.port + '/' + c.database;
  }
  function folderSettings(source = {}) {
    return source.folderPolicy || {root:roots[source.corpus] || roots['Real History'],
      extensions:['csv','json'],recursive:false,parser:'content'};
  }
  function policy(input) {
    const root = localPath(input?.root);
    const subdirectory = input.subdirectory?.trim() ? localPath(input.subdirectory,true).replace(/\\/g,'/').replace(/\/+$/,'') : '';
    const allowed = extensions.filter(ext => input.extensions?.includes(ext));
    if (!allowed.length) throw new Error('Choose at least one allowed extension.');
    if (!['content','manifest'].includes(input.parser)) throw new Error('Choose a supported parser.');
    return {root,subdirectory,extensions:allowed,recursive:input.recursive === true,parser:input.parser};
  }
  function inventory({kind,corpus,format,loc,connection:c,folderPolicy:p}) {
    const examples = samples[corpus];
    const id = corpus === 'Real History' ? 'catalog_id' : 'country_tag';
    const countries = {dataType:'table',fields:[id,'country'],rows:examples.map(([code,name]) => [code,name])};
    const rulers = {dataType:'table',fields:[id,'ruler','as_of'],rows:examples.map(([code,,ruler]) => [code,ruler,'1444-11-11'])};
    const sections = {dataType:'document',fields:[format === 'PDF' ? 'page' : 'section','heading','sample_text'],
      rows:examples.map(([,country,ruler],i) => [String(i+1),country,ruler + ' · 11 November 1444'])};
    const asset = (object,item) => ({object,...item});
    if (kind === 'database') {
      const schema = {PostgreSQL:'public',MySQL:c.database,'SQL Server':'dbo',SQLite:'main'}[c.engine];
      return [asset(schema+'.countries',countries),asset(schema+'.ruler_snapshots',rulers)];
    }
    if (kind === 'folder') {
      const files = [['countries.csv',countries],['ruler_snapshots.json',rulers],['notes.txt',sections],
        ['guide.md',sections],['register.pdf',{...sections,fields:['page','heading','sample_text']}],['archive/former_rulers.csv',rulers],
        ['history/countries/country_history.txt',sections],['missions/mission_notes.txt',sections]];
      const prefix = p.subdirectory ? p.subdirectory+'/' : '';
      return files.filter(([path]) => path.startsWith(prefix) && (p.recursive || !path.slice(prefix.length).includes('/')) && p.extensions.includes(path.split('.').pop()))
        .map(([path,item]) => asset(path,p.parser === 'manifest' ? {dataType:'table',fields:['file_name','extension'],
          rows:[[path,path.split('.').pop()]]} : item));
    }
    if (kind === 'url') return format === 'HTML' ? [asset('Page sections',sections)] :
      [asset('$.countries',countries),asset('$.ruler_snapshots',rulers)];
    const file = loc.split(/[\\/]/).pop();
    if (format === 'PDF') return [asset(file+' · pages',sections)];
    if (format === 'JSON') return [asset(file+' · $.countries',countries),asset(file+' · $.ruler_snapshots',rulers)];
    return [asset(file,countries)];
  }
  // Persist explicit public metadata. A password has no representation in a source record.
  function publicRecord(record) {
    const result = {};
    for (const key of ['id','name','kind','format','access','loc','credential','object','fields','rows','corpus','dataType'])
      if (Object.hasOwn(record,key)) result[key] = record[key];
    if (record.assets) result.assets = record.assets.map(({object,fields,rows,dataType}) =>
      dataType ? {object,fields,rows,dataType} : {object,fields,rows});
    if (record.connection) result.connection = connection(record.connection);
    if (record.folderPolicy) result.folderPolicy = policy(record.folderPolicy);
    return result;
  }
  function syncedAssets(source) {
    const previous = source.assets || [source];
    if (source.kind === 'folder' && source.folderPolicy) return inventory(source);
    if (source.kind !== 'database') return previous;
    const settings = connection(databaseSettings(source));
    const discovered = inventory({...source,connection:settings});
    return [...previous,...discovered.filter(asset => !previous.some(s => s.object === asset.object))];
  }
  window.SourceProfile = {engines,roots,extensions,databaseSettings,connection,address,folderSettings,policy,inventory,publicRecord,syncedAssets};
})();

(() => {
  'use strict';
  const types = [
    {id:'folder',name:'Local folder',example:'workspace/datasets'},
    {id:'postgresql',name:'PostgreSQL schema',example:'postgresql://db.example.test:5432/history/public'},
    {id:'s3',name:'S3 bucket / prefix',example:'s3://history-samples/datasets'}
  ];
  const controls = /[\x00-\x1f\x7f]/u;
  function field(value,label,required = true) {
    const text = String(value ?? '').trim();
    if (required && !text) throw new Error('Enter a ' + label + '.');
    if (controls.test(String(value ?? ''))) throw new Error('Use a ' + label + ' without control characters.');
    return text;
  }
  function hostName(value) {
    const host = field(value,'host name');
    if (host.includes(':')) {
      const literal = host.startsWith('[') && host.endsWith(']') ? host.slice(1,-1) : host;
      if (/^[a-f0-9:.]+$/i.test(literal)) {
        try { return new URL('http://[' + literal + ']/').hostname; } catch { /* Issue a host-specific validation message. */ }
      }
    } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      if (host.split('.').every(octet => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)) return host;
    } else if (host.length <= 254 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/i.test(host)) {
      return host.toLowerCase();
    }
    throw new Error('Enter a host name or IP address without a port or URL.');
  }
  function clean(type,input) {
    if (type === 'folder') {
      const path = field(input.path,'folder path');
      const withoutDrive = path.replace(/^[a-z]:[\\/]/i,'');
      if (/[<>:"|?*]/u.test(withoutDrive) || path.split(/[\\/]/).includes('..')) {
        throw new Error('Enter a folder path without a URL, invalid path characters or parent directory segments.');
      }
      return {path};
    }
    if (type === 'postgresql') {
      const host = hostName(input.host);
      const port = field(input.port ?? '5432','port');
      if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Enter a port from 1 to 65535.');
      // Quoted PostgreSQL identifiers can contain spaces and URI-reserved characters.
      const identifier = (value,label) => {
        field(value,label);
        if (value === '.' || value === '..') throw new Error('Enter a ' + label + ' other than a dot path segment.');
        return String(value);
      };
      const database = identifier(input.database,'database name'), schema = identifier(input.schema,'schema name');
      return {host,port:String(Number(port)),database,schema,username:field(input.username,'username',false)};
    }
    if (type === 's3') {
      const bucket = field(input.bucket,'bucket name');
      if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..') || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)) {
        throw new Error('Enter a bucket name of 3–63 lowercase letters, digits, dots or hyphens.');
      }
      const prefix = String(input.prefix ?? '');
      if (controls.test(prefix)) throw new Error('Enter a prefix without control characters.');
      return {bucket,prefix};
    }
    throw new Error('Choose a supported storage type.');
  }
  function address(type,c) {
    if (type === 'folder') return c.path;
    if (type === 'postgresql') return 'postgresql://' + c.host + ':' + c.port + '/' + encodeURIComponent(c.database) + '/' + encodeURIComponent(c.schema);
    return 's3://' + c.bucket + (c.prefix ? '/' + c.prefix.split('/').map(encodeURIComponent).join('/') : '');
  }
  function decode(value) {
    // Old locators accepted a literal percent sign as well as percent-encoded names.
    try { return decodeURIComponent(value); } catch { return value; }
  }
  function fromLocator(type,locator) {
    if (type === 'folder') {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(locator)) throw new Error('Enter a local folder path.');
      return {path:locator};
    }
    let uri;
    try { uri = new URL(locator); } catch { /* Report the expected address format. */ }
    if (uri?.username || uri?.password || /[?#]/.test(locator)) throw new Error('Use a storage locator without credentials, query parameters or a fragment.');
    if (type === 'postgresql' && uri?.protocol === 'postgresql:' && uri.hostname) {
      const parts = /^\/([^/]+)\/([^/]+)\/?$/.exec(uri.pathname);
      if (parts) return {host:uri.hostname,port:uri.port || '5432',database:decode(parts[1]),schema:decode(parts[2]),username:''};
    }
    if (type === 's3' && uri?.protocol === 's3:' && uri.hostname && !uri.port) return {bucket:uri.hostname,prefix:decode(uri.pathname.slice(1))};
    throw new Error(type === 'postgresql' ? 'Enter a PostgreSQL locator with a host, database and schema.' : 'Enter an S3 bucket locator, optionally followed by a prefix.');
  }
  function normalize({type,connection,locator}) {
    if (!types.some(t => t.id === type)) throw new Error('Choose a supported storage type.');
    const legacy = connection == null;
    if (legacy) locator = field(locator,'storage locator');
    const safe = clean(type,legacy ? fromLocator(type,locator) : connection);
    // Existing callers may rely on the spelling of a URI, including an implicit port or a trailing slash.
    return {type,locator:legacy ? locator : address(type,safe),connection:safe};
  }
  function upgrade(entry) {
    const {id,name,type,detail} = entry;
    const locator = String(entry.locator ?? '');
    let connection;
    try {
      connection = fromLocator(type,field(locator,'storage locator'));
    } catch {
      // A damaged legacy address must not discard the workspace or surface embedded credentials.
      return {id,name,type,detail,locator:'',connection:{}};
    }
    // Some legacy locators predate structured validation. Keep their target and ID for existing datasets.
    try { connection = clean(type,connection); } catch { /* Retain the parsed public fields. */ }
    return {id,name,type,detail,locator,connection};
  }
  function sameTarget(a,b) {
    if (a.type !== b.type) return false;
    const fields = {folder:['path'],postgresql:['host','port','database','schema'],s3:['bucket','prefix']}[a.type];
    return fields.every(key => a.connection[key] === b.connection[key]);
  }
  function revise(previous,patch) {
    const type = patch.type ?? previous.type;
    const unchanged = patch.connection == null
      ? type === previous.type && (patch.locator == null || patch.locator === previous.locator)
      : sameTarget(previous,{type,connection:patch.connection});
    if (unchanged) {
      // Metadata and account edits may retain a legacy target that predates today's address rules.
      const connection = {...previous.connection};
      if (type === 'postgresql' && patch.connection?.username !== undefined) connection.username = field(patch.connection.username,'username',false);
      return {type,locator:previous.locator,connection};
    }
    const target = normalize({...patch,type});
    if (sameTarget(previous,target)) target.locator = previous.locator;
    if (type === 'postgresql' && previous.type === type && patch.connection == null) target.connection.username = previous.connection.username;
    return target;
  }
  window.StorageProfile = {types,normalize,upgrade,sameTarget,revise,
    test(input) { return {...normalize(input),simulated:true}; }};
})();

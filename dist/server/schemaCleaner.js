"use strict";
/**
 * Schema cleaner for Google CloudCode / Antigravity Gemini API.
 * Sanitizes JSON Schema tool definitions to adhere strictly to Gemini Proto specifications.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanJSONSchemaForAntigravity = cleanJSONSchemaForAntigravity;
const UNSUPPORTED_SCHEMA_CONSTRAINTS = new Set([
    'minLength', 'maxLength', 'exclusiveMinimum', 'exclusiveMaximum',
    'minItems', 'maxItems', 'format', 'multipleOf',
    'uniqueItems', 'contains',
    'unevaluatedProperties', 'unevaluatedItems', 'contentSchema',
    'prefixItems', 'additionalItems',
    'default', 'examples',
    '$schema', '$defs', 'definitions', 'const', '$ref', '$comment',
    'deprecated', 'readOnly', 'writeOnly',
    'additionalProperties', 'propertyNames', 'patternProperties', 'enumDescriptions',
    'anyOf', 'oneOf', 'allOf', 'not',
    'dependencies', 'dependentSchemas', 'dependentRequired',
    'title', 'optional', '~optional', 'if', 'then', 'else', 'contentMediaType', 'contentEncoding',
    'cornerRadius', 'fillColor', 'fontFamily', 'fontSize', 'fontWeight',
    'gap', 'padding', 'strokeColor', 'strokeThickness', 'textColor',
    'errorMessage', 'errorMessages', 'x-errorMessage', 'x-errorMessages',
    'markdownDescription', 'x-intellij-html-description',
    'x-taplo-info', 'x-taplo', 'doNotSuggest', 'suggestSortText',
    'minProperties', 'maxProperties'
]);
function convertConstToEnum(obj) {
    if (!obj || typeof obj !== 'object')
        return;
    if (obj.const !== undefined && !obj.enum) {
        obj.enum = [obj.const];
        delete obj.const;
    }
    for (const v of Object.values(obj)) {
        if (v && typeof v === 'object')
            convertConstToEnum(v);
    }
}
function convertEnumValuesToStrings(obj) {
    if (!obj || typeof obj !== 'object')
        return;
    if (obj.enum && Array.isArray(obj.enum)) {
        obj.enum = obj.enum.map((v) => String(v));
        if (!obj.type)
            obj.type = 'STRING';
    }
    for (const v of Object.values(obj)) {
        if (v && typeof v === 'object')
            convertEnumValuesToStrings(v);
    }
}
function selectBest(items) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        let score = 0;
        const type = typeof item.type === 'string' ? item.type.toLowerCase() : '';
        if (type === 'object' || item.properties) {
            score = 3;
        }
        else if (type === 'array' || item.items) {
            score = 2;
        }
        else if (type && type !== 'null') {
            score = 1;
        }
        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }
    return bestIdx;
}
function flattenAnyOfOneOf(obj) {
    if (!obj || typeof obj !== 'object')
        return;
    if (obj.anyOf && Array.isArray(obj.anyOf) && obj.anyOf.length > 0) {
        const nonNull = obj.anyOf.filter((s) => s && s.type !== 'null');
        if (nonNull.length > 0) {
            const best = nonNull[selectBest(nonNull)];
            delete obj.anyOf;
            Object.assign(obj, best);
        }
    }
    if (obj.oneOf && Array.isArray(obj.oneOf) && obj.oneOf.length > 0) {
        const nonNull = obj.oneOf.filter((s) => s && s.type !== 'null');
        if (nonNull.length > 0) {
            const best = nonNull[selectBest(nonNull)];
            delete obj.oneOf;
            Object.assign(obj, best);
        }
    }
    for (const v of Object.values(obj)) {
        if (v && typeof v === 'object')
            flattenAnyOfOneOf(v);
    }
}
function mergeAllOf(obj) {
    if (!obj || typeof obj !== 'object')
        return;
    if (obj.allOf && Array.isArray(obj.allOf)) {
        const merged = {};
        for (const item of obj.allOf) {
            if (item.properties) {
                if (!merged.properties)
                    merged.properties = {};
                Object.assign(merged.properties, item.properties);
            }
            if (item.required && Array.isArray(item.required)) {
                if (!merged.required)
                    merged.required = [];
                for (const req of item.required) {
                    if (!merged.required.includes(req))
                        merged.required.push(req);
                }
            }
        }
        delete obj.allOf;
        if (merged.properties)
            obj.properties = { ...obj.properties, ...merged.properties };
        if (merged.required)
            obj.required = [...(obj.required || []), ...merged.required];
    }
    for (const v of Object.values(obj)) {
        if (v && typeof v === 'object')
            mergeAllOf(v);
    }
}
function flattenTypeArrays(obj) {
    if (!obj || typeof obj !== 'object')
        return;
    if (obj.type && Array.isArray(obj.type)) {
        const nonNull = obj.type.filter((t) => t !== 'null');
        if (nonNull.length === 0) {
            obj.type = 'STRING';
        }
        else if (nonNull.length === 1) {
            obj.type = String(nonNull[0]).toUpperCase();
        }
        else {
            if (obj.properties && nonNull.includes('object'))
                obj.type = 'OBJECT';
            else if (obj.items && nonNull.includes('array'))
                obj.type = 'ARRAY';
            else if (nonNull.includes('string'))
                obj.type = 'STRING';
            else if (nonNull.includes('number'))
                obj.type = 'NUMBER';
            else if (nonNull.includes('integer'))
                obj.type = 'INTEGER';
            else if (nonNull.includes('boolean'))
                obj.type = 'BOOLEAN';
            else
                obj.type = String(nonNull[0]).toUpperCase();
        }
    }
    for (const v of Object.values(obj)) {
        if (v && typeof v === 'object')
            flattenTypeArrays(v);
    }
}
function ensureObjectType(obj) {
    if (!obj || typeof obj !== 'object')
        return;
    if (obj.properties && !obj.type)
        obj.type = 'OBJECT';
    for (const [key, v] of Object.entries(obj)) {
        if (!v || typeof v !== 'object')
            continue;
        if (key === 'properties' && !Array.isArray(v)) {
            for (const sub of Object.values(v))
                ensureObjectType(sub);
        }
        else {
            ensureObjectType(v);
        }
    }
}
function ensureArrayItems(obj) {
    if (!obj || typeof obj !== 'object')
        return;
    const t = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
    if (t === 'array') {
        if (!obj.items || typeof obj.items !== 'object' || Object.keys(obj.items).length === 0) {
            obj.items = { type: 'STRING' };
        }
        else if (!obj.items.type) {
            if (obj.items.properties)
                obj.items.type = 'OBJECT';
            else if (obj.items.items)
                obj.items.type = 'ARRAY';
            else
                obj.items.type = 'STRING';
        }
    }
    for (const v of Object.values(obj)) {
        if (v && typeof v === 'object')
            ensureArrayItems(v);
    }
}
function removeUnsupported(obj) {
    if (!obj || typeof obj !== 'object')
        return;
    if (Array.isArray(obj)) {
        for (const item of obj)
            removeUnsupported(item);
        return;
    }
    for (const key of Object.keys(obj)) {
        // DO NOT delete properties inside "properties" dict
        if (UNSUPPORTED_SCHEMA_CONSTRAINTS.has(key) || key.startsWith('x-')) {
            delete obj[key];
            continue;
        }
        const value = obj[key];
        if (value && typeof value === 'object') {
            if (key === 'properties' && !Array.isArray(value)) {
                for (const [propKey, propVal] of Object.entries(value)) {
                    if (propVal && typeof propVal === 'object') {
                        removeUnsupported(propVal);
                    }
                }
            }
            else {
                removeUnsupported(value);
            }
        }
    }
}
function cleanupRequired(obj) {
    if (!obj || typeof obj !== 'object')
        return;
    if (obj.required && Array.isArray(obj.required) && obj.properties) {
        const valid = obj.required.filter((f) => Object.prototype.hasOwnProperty.call(obj.properties, f));
        if (valid.length === 0) {
            delete obj.required;
        }
        else {
            obj.required = valid;
        }
    }
    for (const v of Object.values(obj)) {
        if (v && typeof v === 'object')
            cleanupRequired(v);
    }
}
function addPlaceholders(obj) {
    if (!obj || typeof obj !== 'object')
        return;
    if (Object.keys(obj).length === 0) {
        obj.type = 'OBJECT';
        obj.properties = {
            reason: { type: 'STRING', description: 'Brief explanation' }
        };
        obj.required = ['reason'];
        return;
    }
    const t = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
    if (t === 'object') {
        if (!obj.properties || Object.keys(obj.properties).length === 0) {
            obj.properties = {
                reason: { type: 'STRING', description: 'Brief explanation' }
            };
            obj.required = ['reason'];
        }
    }
    for (const v of Object.values(obj)) {
        if (v && typeof v === 'object')
            addPlaceholders(v);
    }
}
function enforceTypeConstraints(obj) {
    if (!obj || typeof obj !== 'object')
        return;
    if (typeof obj.type === 'string') {
        obj.type = obj.type.toUpperCase();
    }
    const t = obj.type;
    if (t === 'ARRAY') {
        delete obj.properties;
        delete obj.required;
        if (!obj.items)
            obj.items = { type: 'STRING' };
    }
    else {
        delete obj.items;
    }
    if (t !== 'OBJECT') {
        delete obj.properties;
        delete obj.required;
    }
    for (const v of Object.values(obj)) {
        if (v && typeof v === 'object')
            enforceTypeConstraints(v);
    }
}
function cleanJSONSchemaForAntigravity(schema) {
    if (!schema || typeof schema !== 'object')
        return schema;
    const cleaned = JSON.parse(JSON.stringify(schema));
    convertConstToEnum(cleaned);
    convertEnumValuesToStrings(cleaned);
    mergeAllOf(cleaned);
    flattenAnyOfOneOf(cleaned);
    flattenTypeArrays(cleaned);
    ensureObjectType(cleaned);
    ensureArrayItems(cleaned);
    removeUnsupported(cleaned);
    cleanupRequired(cleaned);
    addPlaceholders(cleaned);
    enforceTypeConstraints(cleaned);
    return cleaned;
}

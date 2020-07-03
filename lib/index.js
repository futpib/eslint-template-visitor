
const Multimap = require('multimap');

const espree = require('espree');

const { getMatchKeys } = require('./match-keys');
const { nodesPropertiesEqual } = require('./nodes-properties-equal');

const gensym = () => 'gensym' + Math.random().toString(16).slice(2);

const nodeEquals = (a, b) => {
	if (a === null || b === null) {
		return a === b;
	}

	const { visitorKeys, equalityKeys } = getMatchKeys(a);

	return visitorKeys.every(key => {
		return nodePropertyEquals(key, a, b);
	}) && equalityKeys.every(key => {
		return nodesPropertiesEqual(a, b, key);
	});
};

const everyNodeEquals = (as, bs) => {
	return as.length === bs.length
		&& as.every((a, index) => {
			const b = bs[index];
			return nodeEquals(a, b);
		});
};

const nodePropertyEquals = (key, a, b) => {
	if (Array.isArray(a[key])) {
		return a[key].length === b[key].length
			&& a[key].every((x, i) => nodeEquals(x, b[key][i]));
	}

	return nodeEquals(a[key], b[key]);
};

class Variable {
	constructor() {
		this._id = gensym();
	}

	_matches() {
		return true;
	}

	toString() {
		return this._id;
	}
}

class SpreadVariable extends Variable {}

class VariableDeclarationVariable extends Variable {
	_matches(node) {
		return node.type === 'VariableDeclaration';
	}

	toString() {
		return `var ${this._id}, `;
	}
}

class TemplateContext {
	constructor() {
		this._matches = new Multimap();
	}

	_pushVariableMatch(variableId, node) {
		this._matches.set(variableId, node);
	}

	getMatches(variable) {
		return this._matches.get(variable._id) || [];
	}

	getMatch(variable) {
		return this.getMatches(variable)[0];
	}
}

class Template {
	constructor(source, options) {
		const parserOptions = options.parserOptions || {
			ecmaVersion: 2018,
		};

		this._id = gensym();

		const { body: [ firstNode ] } = espree.parse(source, parserOptions);

		this._ast = firstNode.type === 'ExpressionStatement' ? firstNode.expression : firstNode;
	}

	toString() {
		return this._id;
	}
}

class TemplateManager {
	constructor(options = {}) {
		this._options = options;
		this._variables = new Map();
		this._templates = new Map();
	}

	_matchTemplate(handler, template, node, ...rest) {
		template.context = new TemplateContext();

		if (this._nodeMatches(template._ast, node, template.context)) {
			return handler(node, ...rest);
		}

		template.context = null;
	}

	_getNodeVariable(templateNode) {
		if (templateNode.type === 'Identifier') {
			return this._variables.get(templateNode.name);
		}

		if (
			templateNode.type === 'VariableDeclaration'
				&& templateNode.kind === 'var'
				&& templateNode.declarations.length > 1
		) {
			const [ firstDeclarator ] = templateNode.declarations;
			return this._variables.get(firstDeclarator.id.name);
		}

		return null;
	}

	_getSpreadVariableNode(templateNode) {
		if (templateNode.type === 'ExpressionStatement') {
			templateNode = templateNode.expression;
		}

		if (!this._getNodeVariable(templateNode)) {
			return undefined;
		}

		const variable = this._variables.get(templateNode.name);

		return variable instanceof SpreadVariable
			? templateNode
			: undefined;
	}

	_nodeMatches(templateNode, node, context) {
		if (!templateNode || !node) {
			return templateNode === node;
		}

		const variable = this._getNodeVariable(templateNode);
		if (variable && variable._matches(node)) {
			const previousMatches = context.getMatches(variable);

			if (previousMatches.every(previousMatchNode => nodeEquals(previousMatchNode, node))) {
				context._pushVariableMatch(variable._id, node);
				return true;
			}

			return false;
		}

		const { visitorKeys, equalityKeys } = getMatchKeys(templateNode);

		const matches = visitorKeys.every(key => {
			return this._nodePropertyMatches(key, templateNode, node, context);
		}) && equalityKeys.every(key => {
			return nodesPropertiesEqual(templateNode, node, key);
		});

		return matches;
	}

	_spreadVariableMatches(templateNode, nodes, context) {
		const variable = this._variables.get(templateNode.name);
		const previousMatches = context.getMatches(variable);

		if (previousMatches.every(previousMatchNodes => everyNodeEquals(previousMatchNodes, nodes))) {
			context._pushVariableMatch(templateNode.name, nodes);
			return true;
		}

		return false;
	}

	_nodePropertyMatches(key, templateNode, node, context) {
		if (Array.isArray(templateNode[key])) {
			if (!node[key]) {
				return false;
			}

			if (templateNode[key].length === 1) {
				const spreadVariableNode = this._getSpreadVariableNode(templateNode[key][0]);

				if (spreadVariableNode) {
					return this._spreadVariableMatches(spreadVariableNode, node[key], context);
				}
			}

			return templateNode[key].length === node[key].length
				&& templateNode[key].every((x, i) => this._nodeMatches(x, node[key][i], context));
		}

		return this._nodeMatches(templateNode[key], node[key], context);
	}

	variable() {
		const variable = new Variable();
		this._variables.set(variable._id, variable);
		return variable;
	}

	spreadVariable() {
		const variable = new SpreadVariable();
		this._variables.set(variable._id, variable);
		return variable;
	}

	variableDeclarationVariable() {
		const variable = new VariableDeclarationVariable();
		this._variables.set(variable._id, variable);
		return variable;
	}

	template(strings, ...vars) {
		const source = typeof strings === 'string'
			? strings
			: strings.map((string, i) => string + (vars[i] || '')).join('');
		const template = new Template(source, this._options);
		this._templates.set(template._id, template);
		return template;
	}

	visitor(visitor) {
		const newVisitor = {};

		for (const key of Object.keys(visitor)) {
			const value = visitor[key];
			const template = this._templates.get(key);

			const newKey = template ? template._ast.type : key;

			const newValue = template ? (...args) => {
				return this._matchTemplate(value, template, ...args);
			} : value;

			newVisitor[newKey] = newVisitor[newKey] || [];
			newVisitor[newKey].push(newValue);
		}

		for (const newKey of Object.keys(newVisitor)) {
			const newValue = newVisitor[newKey];
			newVisitor[newKey] = newValue.length === 1 ? newValue[0] : (...args) => {
				newValue.forEach(handler => handler(...args));
			};
		}

		return newVisitor;
	}
}

const eslintTemplateVisitor = options => new TemplateManager(options);

module.exports = eslintTemplateVisitor;


const test = require('ava');
const sinon = require('sinon');

const espree = require('espree');

const recurse = require('./recurse');

test('recurse.visit', t => {
	const ast = espree.parse(`
		foo.parentNode.removeChild(foo);
		foo.parentNode.removeChild(bar);
	`);

	const spy = sinon.spy();

	recurse.visit(ast, {
		MemberExpression: spy,
	});

	t.is(spy.callCount, 4);
});

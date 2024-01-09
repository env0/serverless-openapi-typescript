const actualUuid = jest.requireActual('uuid');

function mockedUuid() {
    return '81596439-293f-4ad7-a230-c36739d94544';
}

module.exports = {
    ...actualUuid,
    v4: mockedUuid
};

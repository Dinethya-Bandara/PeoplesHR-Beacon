(function (data, args, reqOptions) {
    if (!data?.data || data.data.length === 0) {
        return { message: "Employee not found" };
    }
    const res = data.data
    if (data.data.length > 1) {
        return { data: res,  message: "Multiple employees found. Please specify the employee." };
    }

    return res[0];
})